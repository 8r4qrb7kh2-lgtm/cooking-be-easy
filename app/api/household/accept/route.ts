import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase, createServiceSupabase } from "@/lib/supabase-server";

export async function POST(request: NextRequest) {
  const { token } = await request.json();
  if (!token) {
    return NextResponse.json({ error: "Token is required" }, { status: 400 });
  }

  const supabase = await createServerSupabase();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const service = createServiceSupabase();
  const userId = session.user.id;

  // Look up invite
  const { data: invite } = await service
    .from("household_invites")
    .select("*")
    .eq("token", token)
    .single();

  if (!invite) {
    return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  }

  if (invite.used_by) {
    return NextResponse.json({ error: "This invite has already been used" }, { status: 400 });
  }

  if (new Date(invite.expires_at) < new Date()) {
    return NextResponse.json({ error: "This invite has expired" }, { status: 400 });
  }

  if (invite.created_by === userId) {
    return NextResponse.json({ error: "You can't accept your own invite" }, { status: 400 });
  }

  // Check if user is already in a household
  const { data: existingMembership } = await service
    .from("household_members")
    .select("household_id")
    .eq("user_id", userId)
    .single();

  if (existingMembership) {
    if (existingMembership.household_id === invite.household_id) {
      return NextResponse.json({ error: "You're already in this household" }, { status: 400 });
    }
    return NextResponse.json(
      { error: "You're already sharing a library. Leave your current household first to join a new one." },
      { status: 400 }
    );
  }

  // Add user to household
  const { error: joinErr } = await service
    .from("household_members")
    .insert({ household_id: invite.household_id, user_id: userId });

  if (joinErr) {
    return NextResponse.json({ error: "Failed to join household" }, { status: 500 });
  }

  // Mark invite as used
  await service
    .from("household_invites")
    .update({ used_by: userId })
    .eq("id", invite.id);

  // Migrate user's existing weekly_plans and shopping_list to use the household_id
  await service
    .from("weekly_plans")
    .update({ household_id: invite.household_id })
    .eq("user_id", userId);

  await service
    .from("shopping_list")
    .update({ household_id: invite.household_id })
    .eq("user_id", userId);

  return NextResponse.json({ success: true });
}
