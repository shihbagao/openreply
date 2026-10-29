import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/lib/auth";

export async function middleware(req: NextRequest) {
  const session = await auth();
  const { pathname } = req.nextUrl;

  // 當使用者試圖存取 /dashboard 但資料庫內無效或 Session 已過期
  if (pathname.startsWith("/dashboard") && !session) {
    const loginUrl = new URL("/login", req.url);
    const response = NextResponse.redirect(loginUrl);

    // 強制在發出 307 轉向時清空瀏覽器中的舊 Session Cookie
    const cookieNames = [
      "authjs.session-token",
      "__Secure-authjs.session-token",
      "next-auth.session-token",
      "__Secure-next-auth.session-token",
    ];

    for (const name of cookieNames) {
      response.cookies.set(name, "", { maxAge: 0, path: "/" });
    }

    return response;
  }

  return NextResponse.next();
}

// 設定 Middleware 作用範圍
export const config = {
  matcher: ["/dashboard/:path*"],
};