"use client";

/**
 * Gold hero: copy wraps on the left. Right side matches the reference hash —
 * many parallel black diagonals, hairline → heavy, gold still showing between
 * them. Stripes are a fixed graphic on the right (non-scaling strokes) so they
 * never grow toward the title. Narrow windows clip the panel from the left;
 * lines disappear before they reach PARANOIA.
 */
const STRIPE_W = 300;
const LINE_COUNT = 17;

export function HeroBanner() {
  return (
    <div className="relative overflow-hidden bg-brand-gold text-brand-ink">
      <div className="flex items-stretch">
        <div
          className="min-w-0 flex-1 py-8 sm:py-12 pr-4 sm:pr-6"
          style={{
            paddingLeft:
              "max(1rem, calc((100vw - min(72rem, 100vw)) / 2 + 0.25rem + 1.35rem))",
          }}
        >
          <div className="flex items-center gap-2 text-[10px] sm:text-xs font-mono uppercase tracking-[0.2em] text-brand-ink/70 mb-3">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            System Online
          </div>
          <h1 className="tracking-tight font-[family-name:var(--font-display)] leading-[0.95] text-brand-ink break-words">
            <span className="text-2xl sm:text-4xl">RALLYSAFE</span>
            <br />
            <span className="text-brand-maroon text-4xl sm:text-6xl">PARANOIA</span>
          </h1>
          <p className="text-brand-ink/70 mt-3 text-sm sm:text-base font-medium whitespace-normal break-words max-w-[36rem]">
            Track your friends live on stage. Get texted the moment they start, finish, post a
            time, or go quiet.
          </p>
        </div>
        <div
          aria-hidden
          className="relative shrink-0 self-stretch overflow-hidden"
          style={{
            width: `min(${STRIPE_W}px, max(0px, calc(100vw - 26rem)))`,
          }}
        >
          <svg
            className="absolute right-0 top-0 h-full"
            width={STRIPE_W}
            viewBox={`0 0 ${STRIPE_W} 280`}
            preserveAspectRatio="none"
            style={{ width: STRIPE_W, height: "100%" }}
          >
            {Array.from({ length: LINE_COUNT }).map((_, i) => {
              const t = i / (LINE_COUNT - 1);
              const x = 36 + i * 16.2;
              const width = 1.15 + t * 3.2 + t * t * 8.5;
              return (
                <line
                  key={i}
                  x1={x}
                  y1={-60}
                  x2={x - 100}
                  y2={340}
                  stroke="#0a0a0a"
                  strokeWidth={width}
                  strokeLinecap="butt"
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
          </svg>
        </div>
      </div>
    </div>
  );
}
