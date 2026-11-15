import type { Avatar as AvatarData } from '../../../shared/types.ts';

// Soft organic shapes in a 100x100 box. `eyes` is the vertical center of the face.
export const BLOB_SHAPES: { path: string; eyes: number }[] = [
  { path: 'M50 9C79 9 92 16 92 48C92 82 80 91 50 91C20 91 8 82 8 48C8 16 21 9 50 9Z', eyes: 50 },
  { path: 'M50 6C76 6 94 24 94 50C94 76 76 94 50 94C24 94 6 76 6 50C6 24 24 6 50 6Z', eyes: 48 },
  { path: 'M50 5C60 20 90 40 90 62C90 83 72 95 50 95C28 95 10 83 10 62C10 40 40 20 50 5Z', eyes: 62 },
  { path: 'M28 30C30 16 46 10 56 18C64 8 82 12 84 28C96 32 98 50 92 60C96 78 82 92 64 90C56 96 40 96 32 90C14 92 4 78 10 62C2 50 10 32 28 30Z', eyes: 55 },
  { path: 'M20 24C34 13 66 13 80 24C95 36 96 66 82 78C68 90 32 90 18 78C4 66 5 36 20 24Z', eyes: 50 },
  { path: 'M53 6C79 8 93 30 91 56C89 80 70 94 48 94C24 94 8 78 10 54C12 28 29 4 53 6Z', eyes: 50 },
];

// Two eyes, optionally with a smile. Drawn relative to the face center.
export const BLOB_FACES = ['dots', 'dots-smile', 'ovals', 'ovals-smile', 'happy'] as const;

export const BLOB_COLORS = [
  '#FF5A4E',
  '#FF8A3D',
  '#FFB938',
  '#3CC48F',
  '#2FB5C9',
  '#4C8DF6',
  '#7B6CF6',
  '#E66BB3',
  '#2B2B2E',
  '#A9AAB0',
];

function isLight(hex: string) {
  const n = parseInt(hex.slice(1, 7), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  // Relative luminance (ITU-R BT.709 weights); above the midpoint dark features read better.
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.6;
}

function Face({ face, y, color }: { face: number; y: number; color: string }) {
  const kind = BLOB_FACES[face % BLOB_FACES.length];
  const smile = <path d={`M43 ${y + 10}Q50 ${y + 16} 57 ${y + 10}`} stroke={color} strokeWidth={3.2} strokeLinecap="round" fill="none" />;
  if (kind === 'happy') {
    return (
      <g stroke={color} strokeWidth={3.4} strokeLinecap="round" fill="none">
        <path d={`M35 ${y + 1}Q40 ${y - 6} 45 ${y + 1}`} />
        <path d={`M55 ${y + 1}Q60 ${y - 6} 65 ${y + 1}`} />
      </g>
    );
  }
  const ovals = kind.startsWith('ovals');
  return (
    <g fill={color}>
      {ovals ? (
        <>
          <ellipse cx={40} cy={y} rx={4.2} ry={6.5} />
          <ellipse cx={60} cy={y} rx={4.2} ry={6.5} />
        </>
      ) : (
        <>
          <circle cx={40} cy={y} r={4.6} />
          <circle cx={60} cy={y} r={4.6} />
        </>
      )}
      {kind.endsWith('smile') && smile}
    </g>
  );
}

export function Blob({ color, shape, face, size }: { color: string; shape: number; face: number; size: number }) {
  const s = BLOB_SHAPES[shape % BLOB_SHAPES.length];
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" className="shrink-0">
      <path d={s.path} fill={color} />
      <Face face={face} y={s.eyes} color={isLight(color) ? '#1b1b1d' : '#ffffff'} />
    </svg>
  );
}

function hash(text: string) {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h);
}

/** A stable blob for things without a chosen avatar, such as a new group. */
export function defaultAvatar(seed: string): AvatarData {
  const h = hash(seed);
  return { kind: 'blob', color: BLOB_COLORS[h % BLOB_COLORS.length], shape: h % BLOB_SHAPES.length, face: h % BLOB_FACES.length };
}

export function Avatar({ avatar, size }: { avatar: AvatarData; size: number }) {
  if (avatar.kind === 'blob') return <Blob color={avatar.color} shape={avatar.shape} face={avatar.face} size={size} />;
  if (avatar.kind === 'emoji') {
    return (
      <span
        aria-hidden="true"
        className="inline-flex shrink-0 items-center justify-center rounded-full"
        style={{ width: size, height: size, background: avatar.color, fontSize: size * 0.55, lineHeight: 1 }}
      >
        {avatar.emoji}
      </span>
    );
  }
  return <img src={avatar.dataUrl} alt="" width={size} height={size} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />;
}
