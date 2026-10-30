import assert from "node:assert/strict";
import test from "node:test";
import { decideReminder } from "./reminder_scheduler.ts";

test("reminds a storefront order when its delivery deadline is tomorrow", () => {
  const result = decideReminder({
    shipmentId: "order-1842",
    event: "in_transit",
    deadline: "2026-10-25T12:00:00Z",
  }, new Date("2026-10-24T13:00:00Z"));
  assert.deepEqual(result, {
    shipmentId: "order-1842",
    action: "remind",
    reason: "delivery deadline is within 24 hours",
  });
});

test("holds an exception instead of notifying the buyer", () => {
  const result = decideReminder({
    shipmentId: "order-1843",
    event: "in_transit",
    deadline: "2026-10-24T16:00:00Z",
    exception: "address review",
  }, new Date("2026-10-24T13:00:00Z"));
  assert.equal(result.action, "hold");
});
