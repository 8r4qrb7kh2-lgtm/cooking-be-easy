import { NextResponse } from "next/server";
import { createServerSupabase, createServiceSupabase } from "@/lib/supabase-server";

export async function POST() {
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error("SUPABASE_SERVICE_ROLE_KEY is not set");
      return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
    }

    const supabase = await createServerSupabase();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const service = createServiceSupabase();
    const userId = session.user.id;

    // Check if user already has a household
    const { data: existing, error: lookupErr } = await service
      .from("household_members")
      .select("household_id")
      .eq("user_id", userId)
      .single();

    if (lookupErr && lookupErr.code !== "PGRST116") {
      // PGRST116 = "no rows found" which is expected; anything else is a real error
      console.error("Household lookup error:", lookupErr);
      return NextResponse.json({ error: "Failed to check household membership", detail: lookupErr.message }, { status: 500 });
    }

    let householdId: string;

    if (existing) {
      householdId = existing.household_id;
    } else {
      // Create a new household
      const { data: household, error: hErr } = await service
        .from("households")
        .insert({})
        .select("id")
        .single();

      if (hErr || !household) {
        console.error("Create household error:", hErr);
        return NextResponse.json({ error: "Failed to create household", detail: hErr?.message }, { status: 500 });
      }

      householdId = household.id;

      // Add current user as member
      const { error: mErr } = await service
        .from("household_members")
        .insert({ household_id: householdId, user_id: userId });

      if (mErr) {
        console.error("Add member error:", mErr);
        return NextResponse.json({ error: "Failed to add member", detail: mErr.message }, { status: 500 });
      }

      // Migrate user's existing weekly_plans, shopping_list, and meal plan to use household_id
      await service
        .from("weekly_plans")
        .update({ household_id: householdId })
        .eq("user_id", userId);

      await service
        .from("shopping_list")
        .update({ household_id: householdId })
        .eq("user_id", userId);

      await service
        .from("meal_plan_entries")
        .update({ household_id: householdId })
        .eq("user_id", userId);
    }

    // Create invite
    const { data: invite, error: iErr } = await service
      .from("household_invites")
      .insert({ household_id: householdId, created_by: userId })
      .select("token")
      .single();

    if (iErr || !invite) {
      console.error("Create invite error:", iErr);
      return NextResponse.json({ error: "Failed to create invite", detail: iErr?.message }, { status: 500 });
    }

    return NextResponse.json({ token: invite.token });
  } catch (err) {
    console.error("Invite route unexpected error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
