import { useEffect, useState } from 'react';
import { hexToRgb, isHexColor, luminance, normalizeHex, rgbToHex, WALL_PALETTE, type RGB } from '@/lib/color';
import { Icon } from '@/ui/Icon';

export function ColorPicker({ value, onChange }: { value: string; onChange(hex: string): void }) {
  const rgb = hexToRgb(value);
  const [hexText, setHexText] = useState(value);
  useEffect(() => setHexText(value), [value]);

  const setChannel = (k: keyof RGB, n: number) => onChange(rgbToHex({ ...rgb, [k]: Number.isFinite(n) ? n : 0 }));
  const named = WALL_PALETTE.flatMap((g) => g.colors).find((c) => c.hex === value);

  return (
    <div className="color-picker">
      <div className="color-current">
        <div className="color-chip" style={{ background: value }} />
        <div>
          <div className="color-name">{named?.name ?? 'Custom colour'}</div>
          <div className="color-values">
            RGB {rgb.r}, {rgb.g}, {rgb.b} · {value.toUpperCase()}
          </div>
        </div>
      </div>

      {WALL_PALETTE.map((group) => (
        <div key={group.group} className="swatch-group">
          <div className="label">{group.group}</div>
          <div className="swatches">
            {group.colors.map((c) => (
              <button
                key={c.hex}
                className={`swatch ${c.hex === value ? 'on' : ''}`}
                style={{ background: c.hex, color: luminance(c.hex) > 0.4 ? '#111' : '#fff' }}
                onClick={() => onChange(c.hex)}
                title={`${c.name} — ${c.hex.toUpperCase()}`}
                aria-label={c.name}
              >
                {c.hex === value && <Icon name="check" size={14} />}
              </button>
            ))}
          </div>
        </div>
      ))}

      <div className="swatch-group">
        <div className="label">Custom</div>
        <div className="custom-color">
          <label className="native-color" title="Open colour picker">
            <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
            <span style={{ background: value }} />
          </label>
          <input
            className="hex-input"
            value={hexText}
            maxLength={7}
            spellCheck={false}
            onChange={(e) => {
              setHexText(e.target.value);
              if (isHexColor(e.target.value) && e.target.value.replace('#', '').length === 6) onChange(normalizeHex(e.target.value));
            }}
            onBlur={() => setHexText(value)}
            aria-label="Hex colour"
          />
        </div>
        <div className="rgb-rows">
          {(['r', 'g', 'b'] as const).map((k) => (
            <div key={k} className="rgb-row">
              <span className="rgb-label">{k.toUpperCase()}</span>
              <input
                type="range"
                min={0}
                max={255}
                value={rgb[k]}
                onChange={(e) => setChannel(k, Number(e.target.value))}
                className={`rgb-slider rgb-${k}`}
                aria-label={`${k.toUpperCase()} channel`}
              />
              <input
                type="number"
                min={0}
                max={255}
                value={rgb[k]}
                onChange={(e) => setChannel(k, Number(e.target.value))}
                className="rgb-num"
                aria-label={`${k.toUpperCase()} value`}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
