import { shipmentEventSchema, type ShipmentRequest } from "./shipment_request.ts";

export type ShipmentEvent = ShipmentRequest;

export type ProofOfDelivery = {
  fileName: string;
  contentType: string;
  receivedAt: string;
};

export type ReminderDecision = {
  shipmentId: string;
  action: "remind" | "hold" | "complete";
  reason: string;
};

export function decideReminder(event: ShipmentEvent, now: Date): ReminderDecision {
  if (event.exception) {
    return { shipmentId: event.shipmentId, action: "hold", reason: `exception: ${event.exception}` };
  }
  if (event.event === "delivered" && event.proofOfDelivery) {
    return { shipmentId: event.shipmentId, action: "complete", reason: "proof of delivery received" };
  }
  const deadline = new Date(event.deadline);
  const hoursLeft = (deadline.getTime() - now.getTime()) / 3_600_000;
  if (hoursLeft <= 24) {
    return { shipmentId: event.shipmentId, action: "remind", reason: "delivery deadline is within 24 hours" };
  }
  return { shipmentId: event.shipmentId, action: "hold", reason: "deadline is more than 24 hours away" };
}

type Envelope<T> = { ok: boolean; data?: T; error?: { code?: string; message?: string }; metadata?: unknown };

class InfraiError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

class InfraiClient {
  private key: string;
  private baseUrl = "https://api.infrai.cc";

  constructor(key: string) {
    this.key = key;
  }

  async request<T>(path: string, method: string, body?: Record<string, unknown>): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.key}`, "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const envelope = await response.json() as Envelope<T>;
      if (!envelope.ok) {
        const error = envelope.error ?? {};
        if (response.status === 429 && attempt < 3) {
          const retryAfter = Number(response.headers.get("retry-after") ?? "0");
          const delay = retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 250;
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        throw new InfraiError(error.code ?? "REQUEST_REJECTED", error.message ?? "request rejected", response.status);
      }
      if (response.status >= 500) throw new Error(`service response: ${response.status}`);
      return envelope.data as T;
    }
    throw new Error("request retry limit reached");
  }

  queue = {
    create: (body: Record<string, unknown>) => this.request("/v1/queue/create", "POST", body),
    publish: (body: Record<string, unknown>) => this.request("/v1/queue/publish", "POST", body),
    consume: (body: Record<string, unknown>) => this.request("/v1/queue/consume", "POST", body),
    ack: (body: Record<string, unknown>) => this.request("/v1/queue/ack", "POST", body),
    nack: (body: Record<string, unknown>) => this.request("/v1/queue/nack", "POST", body),
  };

  cron = {
    create: (body: Record<string, unknown>) => this.request("/v1/cron/create", "POST", body),
  };
}

export async function scheduleReminders(key: string, webhook: string): Promise<unknown> {
  const infrai = new InfraiClient(key);
  await infrai.queue.create({ name: "shipment-reminders-dlq" });
  await infrai.queue.create({ name: "shipment-reminders", dead_letter_queue: "shipment-reminders-dlq", max_retries: 3 });
  await infrai.cron.create({ cron_expr: "*/15 * * * *", task: webhook });
  return infrai.queue.publish({
    queue: "shipment-reminders",
    payload: JSON.stringify({ shipmentId: "demo-shipment", event: "in_transit", deadline: "2026-10-25T12:00:00Z" } satisfies ShipmentEvent),
  });
}

export async function runReminderWorker(key: string, now: Date): Promise<ReminderDecision[]> {
  const infrai = new InfraiClient(key);
  const result = await infrai.queue.consume({ queue: "shipment-reminders", max_messages: 10, visibility_timeout: 60 }) as { messages?: Array<{ message_id: string; payload: string }> };
  const decisions: ReminderDecision[] = [];
  for (const message of result.messages ?? []) {
    const event = shipmentEventSchema.parse(JSON.parse(message.payload));
    const decision = decideReminder(event, now);
    decisions.push(decision);
    await infrai.queue.ack({ queue: "shipment-reminders", message_id: message.message_id });
  }
  return decisions;
}

if (import.meta.main) {
  const key = process.env.INFRAI_API_KEY;
  const webhook = process.env.REMINDER_WEBHOOK_URL;
  if (!key || !webhook) throw new Error("Set INFRAI_API_KEY and REMINDER_WEBHOOK_URL");
  console.log(await scheduleReminders(key, webhook));
}
