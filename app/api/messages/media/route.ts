import { database, ensureDatabase, mediaBucket } from "../../../../db/runtime";
import { getViewer } from "../../../../db/viewer";

const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const ACCEPTED_VIDEO_TYPES = new Set(["video/mp4", "video/quicktime", "video/x-m4v", "video/3gpp"]);

async function access() {
  const viewer = await getViewer();
  if (viewer.access === "pending") return { viewer, enabled: false };
  await ensureDatabase();
  const setting = await database().prepare("SELECT value FROM workspace_settings WHERE key = ?").bind(`messaging_enabled:${viewer.businessId}`).first<{ value: string }>();
  return { viewer, enabled: setting?.value !== "false" };
}

export async function POST(request: Request) {
  const { viewer, enabled } = await access();
  if (viewer.access === "pending") return Response.json({ error: "Not authorized" }, { status: 403 });
  if (!enabled) return Response.json({ error: "Messaging is disabled by the owner." }, { status: 403 });
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.toLowerCase() ?? "";
  const declaredSize = Number(request.headers.get("x-upload-size"));
  if (!ACCEPTED_VIDEO_TYPES.has(contentType)) return Response.json({ error: "Choose an MP4, MOV, M4V, or 3GP video." }, { status: 400 });
  if (!Number.isFinite(declaredSize) || declaredSize < 1 || declaredSize > MAX_VIDEO_BYTES) return Response.json({ error: "Choose a video up to 100 MB." }, { status: 413 });
  if (!request.body) return Response.json({ error: "The video could not be read." }, { status: 400 });

  let received = 0;
  const limitedBody = request.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      received += chunk.byteLength;
      if (received > MAX_VIDEO_BYTES) {
        controller.error(new Error("Video exceeds the 100 MB limit."));
        return;
      }
      controller.enqueue(chunk);
    },
  }));
  const key = `messages/${viewer.businessId}/${crypto.randomUUID()}`;
  try {
    await mediaBucket().put(key, limitedBody, { httpMetadata: { contentType } });
  } catch {
    return Response.json({ error: "The video upload could not be completed. Try a smaller video." }, { status: 413 });
  }
  return Response.json({ key }, { status: 201 });
}
