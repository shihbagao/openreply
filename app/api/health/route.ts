import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  // 💡 直接回傳 200 OK，不發送任何 Redis Ping 或 Database 查詢，徹底切斷無謂的 Command 消耗
  return NextResponse.json(
    { status: "ok", timestamp: new Date().toISOString() },
    { status: 200 }
  );
}
