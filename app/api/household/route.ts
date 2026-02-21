import { NextResponse } from "next/server";
import { createServerSupabase, createServiceSupabase } from "@/lib/supabase-server";

export async function GET() {
  const supabase = await createServerSupabase();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const service = createServiceSupabase();
  const userId = session.user.id;

  // Find user's household
  const { data: membership } = await service
    .from("household_members")
    .select("household_id")
    .eq("user_id", userId)
    .single();

  if (!membership) {
    return NextResponse.json({ household: null });
  }

  // Get all members
  const { data: members } = await service
    .from("household_members")
    .select("user_id, joined_at")
    .eq("household_id", membership.household_id);

  // Get user emails from auth.users
  const memberDetails = await Promise.all(
    (members || []).map(async (m) => {
      const { data: { user } } = await service.auth.admin.getUserById(m.user_id);
      return {
        id: m.user_id,
        email: user?.email || "Unknown",
        joinedAt: m.joined_at,
        isYou: m.user_id === userId,
      };
    })
  );

  return NextResponse.json({
    household: {
      id: membership.household_id,
      members: memberDetails,
    },
  });
}
