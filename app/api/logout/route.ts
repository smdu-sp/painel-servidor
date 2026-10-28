import { NextResponse } from "next/server";
import { COOKIE, acessoSeguro, opcoesCookie } from "@/lib/auth";

export async function POST(req: Request) {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, "", opcoesCookie(0, acessoSeguro(req)));
  return res;
}
