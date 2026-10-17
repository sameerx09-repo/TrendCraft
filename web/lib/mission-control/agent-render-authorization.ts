import "server-only";
type Authorization = {
  postId: string;
  onTaskCreated: (id: string) => Promise<void>;
  imageDataUri?: string;
};
const state = globalThis as unknown as {
  agentRenderRequests?: WeakMap<Request, Authorization>;
};
const requests = (state.agentRenderRequests ??= new WeakMap<
  Request,
  Authorization
>());
export function agentRenderRequest(
  url: string,
  postId: string,
  onTaskCreated: (id: string) => Promise<void>,
  imageDataUri?: string,
) {
  const request = new Request(url, { method: "POST" });
  requests.set(request, { postId, onTaskCreated, imageDataUri });
  return request;
}
export function agentRenderAuthorization(request: Request, postId: string) {
  const authorization = requests.get(request);
  return authorization?.postId === postId ? authorization : undefined;
}
