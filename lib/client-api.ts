export async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data as T;
}

export async function uploadCaseAsset(
  caseId: string,
  file: File,
  kind: "audio" | "image",
) {
  const { uploadUrl } = await jsonRequest<{ uploadUrl: string }>(`/api/cases/${caseId}/upload-url`, {
    method: "POST",
  });
  const upload = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!upload.ok) throw new Error("File upload failed");
  const { storageId } = await upload.json();
  return await jsonRequest<{ assetId: string }>(`/api/cases/${caseId}/assets`, {
    method: "POST",
    body: JSON.stringify({
      storageId,
      kind,
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
    }),
  });
}
