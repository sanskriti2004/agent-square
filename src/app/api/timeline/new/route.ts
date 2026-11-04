import { countNewer } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const after = new URL(request.url).searchParams.get("after");
  const valid = after && /^[0-9a-f-]{36}$/i.test(after) ? after : null;
  return Response.json(await countNewer(valid));
}
