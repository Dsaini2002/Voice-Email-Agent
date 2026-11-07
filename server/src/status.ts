import type { ObjectId } from "mongodb";
import type { SyncStatus } from "../../shared/types.js";

export type State = Pick<SyncStatus, "state" | "message">;
const status = new Map<string, State>();

export function setStatus(userId: ObjectId, s: State): void {
  status.set(userId.toHexString(), s);
}

export function getStatus(userId: ObjectId): State {
  return status.get(userId.toHexString()) ?? { state: "idle", message: "" };
}
