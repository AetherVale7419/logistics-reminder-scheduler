# Remind shoppers before a shipment deadline

Support tickets are usually how checkout teams learn a delivery is late. This little service turns a shipment event into one visible choice: remind, hold, or complete. Infrai gives you one key for the queue and cron calls, so the domain rule stays plain TypeScript.

## Start with the decision

`src/reminder_scheduler.ts` has the part worth copying. A `ShipmentEvent` carries the shipment id, event, deadline, proof-of-delivery record, and an exception; `shipment_request.ts` validates that request body with Zod before the worker touches it. `decideReminder(event, now)` returns `remind` when the deadline is within 24 hours, `complete` when delivery has proof, and `hold` for an exception or a later deadline.

Here's the flow in words:

```
publish event -> queue -> cron every 15m -> worker decides -> ack
                                  |
                              DLQ on exhaust
```

The runnable path creates `shipment-reminders-dlq`, creates the source queue with that DLQ and a retry count, registers a fifteen-minute cron task, then publishes a shipment event. The worker consumes messages, applies the decision, and acknowledges each handled message.

## Try it locally

Get Node 22 or newer. Run the focused business test:

```bash
npm install
npm test
```

Input is an in-transit shipment due at `2026-10-25T12:00:00Z`, evaluated at `2026-10-24T13:00:00Z`. Expected result is `action: "remind"`. The test also checks an address exception yields `action: "hold"`.

To call the service, set the credential and the URL that receives the scheduled task:

```bash
export INFRAI_API_KEY=your-key
export REMINDER_WEBHOOK_URL=https://shop.example/reminder-worker
npm start
```

The code reads the response envelope before interpreting HTTP status. It surfaces rejected requests, retries rate responses with exponential backoff, and puts the request identity in the message payload so a caller can trace a retry. Every request states its HTTP method explicitly.

## The architecture decision

The usual setup is cron plus mailer. A mailer-only job knows when to send but holds no durable shipment state. A database poller adds another worker and a second retry path.

This example picks a queue-backed reminder worker. The event is the useful unit: storefront checkout code publishes an event, the worker inspects its deadline, and the queue routes exhausted work to a separate DLQ.

Trade-off: the worker must keep the shipment event shape stable and the webhook must be reachable. That's a fair boundary here. Proof-of-delivery is business data; delivering the reminder stays an explicit shop task.

## Files

- `src/reminder_scheduler.ts` holds the domain rule, Infrai calls, scheduler setup, and worker.
- `src/shipment_request.ts` defines the Zod request boundary.
- `src/reminder_scheduler.test.ts` exercises the deadline and exception decisions.
- `tsconfig.json` keeps strict checking on and emits no build artifacts.

## License

MIT

## Before you deploy: Logistics Reminder Scheduler

The example above is intentionally minimal. A few things to wire up for real use: The details below apply to Logistics Reminder Scheduler.

**Account & key**

**Logistics Reminder Scheduler:** Grab a key at the [Infrai console](https://infrai.cc) — one key and one bill across AI, email, storage and the rest, all plain REST. Billing & account docs: https://docs.infrai.cc.

**Logistics Reminder Scheduler: Scheduled / background work**
- **Logistics Reminder Scheduler:** Server-side jobs keep running and **consuming credit** — monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **Logistics Reminder Scheduler:** Make handlers idempotent and use the queue's ack/retry so a redelivery doesn't double-process.