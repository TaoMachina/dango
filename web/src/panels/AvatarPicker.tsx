import { useRef, useState, type ReactNode } from 'react';
import { ImageUp } from 'lucide-react';
import type { Avatar as AvatarData } from '../../../shared/types.ts';
import { Avatar, Blob, BLOB_COLORS, BLOB_FACES, BLOB_SHAPES } from '../components/Avatar.tsx';
import { Button, inputClass } from '../components/ui.tsx';
import { imageToAvatarDataUrl } from '../lib/image.ts';

function firstGrapheme(text: string) {
  const first = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text.trim())[Symbol.iterator]().next();
  return first.done ? '' : first.value.segment;
}

function Choice({ selected, label, onClick, children }: { selected: boolean; label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={selected}
      onClick={onClick}
      className={`flex items-center justify-center rounded-xl p-1 ${selected ? 'bg-selected ring-1 ring-faint' : 'hover:bg-hover'}`}
    >
      {children}
    </button>
  );
}

export function AvatarPicker({ value, onChange }: { value: AvatarData; onChange: (avatar: AvatarData) => void }) {
  const blob = value.kind === 'blob' ? value : { kind: 'blob' as const, color: value.kind === 'emoji' ? value.color : BLOB_COLORS[0], shape: 0, face: 0 };
  const color = value.kind === 'image' ? BLOB_COLORS[0] : value.color;
  const [emoji, setEmoji] = useState(value.kind === 'emoji' ? value.emoji : '');
  const file = useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex justify-center">
        <Avatar avatar={value} size={64} />
      </div>
      <div>
        <p className="mb-1 text-[12px] text-muted">Color</p>
        <div className="grid grid-cols-10 gap-1">
          {BLOB_COLORS.map((c, index) => (
            <button
              key={c}
              type="button"
              aria-label={`Color ${index + 1}`}
              aria-pressed={c === color}
              onClick={() => onChange(value.kind === 'emoji' ? { ...value, color: c } : { ...blob, color: c })}
              className={`aspect-square rounded-full ${c === color ? 'ring-2 ring-fg ring-offset-2 ring-offset-bg' : ''}`}
              style={{ background: c }}
            />
          ))}
        </div>
      </div>
      <div>
        <p className="mb-1 text-[12px] text-muted">Shape</p>
        <div className="grid grid-cols-6 gap-1">
          {BLOB_SHAPES.map((_, index) => (
            <Choice key={index} label={`Shape ${index + 1}`} selected={value.kind === 'blob' && value.shape === index} onClick={() => onChange({ ...blob, color, shape: index })}>
              <Blob color={color} shape={index} face={blob.face} size={34} />
            </Choice>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-1 text-[12px] text-muted">Face</p>
        <div className="grid grid-cols-6 gap-1">
          {BLOB_FACES.map((name, index) => (
            <Choice key={name} label={`Face ${index + 1}`} selected={value.kind === 'blob' && value.face === index} onClick={() => onChange({ ...blob, color, face: index })}>
              <Blob color={color} shape={blob.shape} face={index} size={34} />
            </Choice>
          ))}
        </div>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const picked = firstGrapheme(emoji);
          if (picked) onChange({ kind: 'emoji', emoji: picked, color });
        }}
      >
        <input className={inputClass} value={emoji} onChange={(e) => setEmoji(e.target.value)} placeholder="Emoji" aria-label="Emoji" />
        <Button type="submit" disabled={!firstGrapheme(emoji)}>
          Use
        </Button>
      </form>
      <input
        ref={file}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const picked = e.target.files?.[0];
          if (picked) void imageToAvatarDataUrl(picked).then((dataUrl) => onChange({ kind: 'image', dataUrl }));
          e.target.value = '';
        }}
      />
      <Button onClick={() => file.current!.click()}>
        <ImageUp size={16} /> Upload image
      </Button>
    </div>
  );
}
