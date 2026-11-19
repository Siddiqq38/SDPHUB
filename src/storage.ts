// Penyimpanan file privat. Unggah dan unduh langsung ke/dari storage lewat URL bertanda tangan berumur pendek,
// sehingga isi file tidak melewati fungsi serverless (batas body Vercel 4,5 MB). Server hanya memberi izin dan mengonfirmasi.

export interface UploadTicket {
  url: string;
  method: 'PUT' | 'POST';
  fields: Record<string, string>; // field form tambahan
  file_field: string;             // nama field form untuk berkas
}
export interface Storage {
  createUpload(key: string, contentType: string): Promise<UploadTicket>;
  stat(key: string): Promise<{ size: number } | null>;
  downloadUrl(key: string, filename: string): Promise<string>;
}

export const MAX_FILE_BYTES = 50 * 1024 * 1024; // batas plan gratis Supabase Storage per berkas

/** Supabase Storage (bucket privat). Membutuhkan SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY (hanya di server). */
export async function supabaseStorage(url: string, serviceKey: string, bucket: string): Promise<Storage> {
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const b = () => sb.storage.from(bucket);
  return {
    async createUpload(key) {
      const { data, error } = await b().createSignedUploadUrl(key);
      if (error || !data) throw new Error('Gagal membuat URL unggah: ' + (error?.message ?? 'tidak diketahui'));
      // Sama dengan supabase-js uploadToSignedUrl: PUT multipart dengan field berkas kosong.
      return { url: data.signedUrl, method: 'PUT', fields: { cacheControl: '3600' }, file_field: '' };
    },
    async stat(key) {
      const i = key.lastIndexOf('/');
      const { data, error } = await b().list(key.slice(0, i), { search: key.slice(i + 1), limit: 5 });
      if (error) throw new Error('Gagal memeriksa file: ' + error.message);
      const hit = data?.find((o) => o.name === key.slice(i + 1));
      const size = Number((hit as any)?.metadata?.size);
      return hit && Number.isFinite(size) ? { size } : null;
    },
    async downloadUrl(key, filename) {
      const { data, error } = await b().createSignedUrl(key, 60, { download: filename });
      if (error || !data) throw new Error('Gagal membuat URL unduh');
      return data.signedUrl;
    },
  };
}
