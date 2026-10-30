import { z } from "zod";

export const shipmentEventSchema = z.object({
  shipmentId: z.string().min(1),
  event: z.enum(["label_created", "in_transit", "delivered"]),
  deadline: z.string().datetime(),
  proofOfDelivery: z.object({
    fileName: z.string().min(1),
    contentType: z.string().min(1),
    receivedAt: z.string().datetime(),
  }).optional(),
  exception: z.string().min(1).optional(),
});

export type ShipmentRequest = z.infer<typeof shipmentEventSchema>;
