// Small helper: returns the owning user_email for an app_id, checking both
// the deployed apps table and the draft projects table. Used by every /api/db/*
// route to enforce ownership.

import { getApp } from "@/lib/store";
import { getDb } from "@/lib/db";

export async function ownerOfApp(appId: string): Promise<string | null> {
  const deployed = await getApp(appId);
  if (deployed) return deployed.user_email;
  const draft = getDb()
    .prepare("SELECT user_email FROM projects WHERE id = ?")
    .get(appId) as { user_email: string } | undefined;
  return draft?.user_email ?? null;
}

export async function userOwnsApp(appId: string, email: string): Promise<boolean> {
  const owner = await ownerOfApp(appId);
  if (!owner) return false;
  return owner.toLowerCase() === email.toLowerCase();
}
