// Avatars render at most 96px; 256px covers that at high pixel density with room to spare.
const SIZE = 256;

/** Center-crop an image file to a square and return it as a 256px WebP data URL. */
export async function imageToAvatarDataUrl(file: File) {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const context = canvas.getContext('2d')!;
  context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, SIZE, SIZE);
  return canvas.toDataURL('image/webp');
}
