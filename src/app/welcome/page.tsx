"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon, type IconName } from "@/components/ui/Icon";
import { markWelcomeSeen } from "@/lib/welcome";

// The two-minute tour for a new starter (or anyone who's forgotten): seven
// cards, one idea each, big pictures, Next / Back. Shown automatically the
// first time an iPad opens the app; the ? on the home screen replays it.

type Slide = { icon: IconName; tone: "green" | "gold" | "red" | "ink"; title: string; body: string; example?: React.ReactNode };

const SLIDES: Slide[] = [
  {
    icon: "shield", tone: "ink", title: "This iPad is our food safety book",
    body: "Every check you do goes in here, with your name and the time. It can't be changed afterwards, so it's proof we did it right.",
  },
  {
    icon: "user", tone: "green", title: "1. Tap your name",
    body: "Start of your shift, tap your name on the home screen. If it already says your name, you're ready.",
    example: <div className="grid grid-cols-3 gap-2">{["Your name", "Someone", "Someone"].map((n, i) => <span key={i} className={`h-12 rounded-xl grid place-items-center text-sm font-semibold ${i === 0 ? "bg-brand text-white" : "bg-paper text-ink-soft"}`}>{n}</span>)}</div>,
  },
  {
    icon: "arrow", tone: "green", title: "2. Do your next job",
    body: "The big green box tells you the next job. Press Start and follow the screen. When it's done, the next one comes up.",
    example: <div className="rounded-2xl bg-brand text-white p-3.5"><p className="text-xs text-white/80">Your next job</p><p className="font-bold text-lg">Fridge temperatures</p><span className="mt-2 inline-flex h-9 items-center rounded-xl bg-white px-4 text-sm font-bold text-brand-deep">Start →</span></div>,
  },
  {
    icon: "alert", tone: "red", title: "Red means now",
    body: "Red is urgent: too warm, too long out, or past its date. Yellow is due soon. Green is done.",
    example: <div className="space-y-1.5">{[["bg-danger text-white", "Do now"], ["bg-gold text-ink", "To do"], ["bg-brand-soft text-brand-deep", "✓ Done"]].map(([c, w]) => <div key={w} className="flex items-center justify-between rounded-xl bg-paper px-3 py-2"><span className="text-sm text-ink">A job</span><span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${c}`}>{w}</span></div>)}</div>,
  },
  {
    icon: "book", tone: "gold", title: "Not sure? Press How?",
    body: "Every job has a How? button with the steps, one at a time. How to wash up, how to cool sausage rolls, what to do if it goes wrong.",
  },
  {
    icon: "flame", tone: "gold", title: "Something happening? Use the big buttons",
    body: "Food out of the oven, a delivery, a customer asking about allergies, something broken, or you feel ill. There's a button for each.",
  },
  {
    icon: "shield", tone: "ink", title: "Inspector walks in?",
    body: "Stay calm. Press \"Inspector here?\" at the bottom of the home screen and hand them the iPad. Everything they need is there. Then get the manager.",
  },
];

const PANEL: Record<Slide["tone"], string> = {
  green: "bg-brand-soft text-brand",
  gold: "bg-gold-soft text-gold-deep",
  red: "bg-danger-soft text-danger",
  ink: "bg-ink text-gold",
};

export default function WelcomePage() {
  const router = useRouter();
  const [i, setI] = useState(0);
  const slide = SLIDES[i];
  const last = i === SLIDES.length - 1;

  function finish() {
    markWelcomeSeen();
    router.replace("/");
  }

  return (
    <div className="flex flex-col flex-1 min-h-[calc(100dvh-8rem)]">
      <div className="px-5 pt-5 max-w-xl w-full mx-auto flex items-center justify-between">
        <p className="text-sm font-semibold text-ink-soft">How this app works · {i + 1} of {SLIDES.length}</p>
        <button type="button" onClick={finish} className="h-11 px-4 text-sm font-semibold text-brand underline underline-offset-2">Skip</button>
      </div>
      <div className="flex-1 px-5 py-6 max-w-xl w-full mx-auto flex flex-col">
        <div className="flex-1 flex flex-col justify-start pt-2">
          <div className={`rounded-[2rem] min-h-56 p-6 grid place-items-center ${PANEL[slide.tone]}`}>
            {slide.example ? (
              <div className="w-full max-w-sm rounded-3xl bg-surface p-4 shadow-sm">{slide.example}</div>
            ) : (
              <Icon name={slide.icon} size={104} strokeWidth={1.5} />
            )}
          </div>
          <h1 className="mt-6 font-display text-[32px] leading-tight font-semibold text-ink">{slide.title}</h1>
          <p className="mt-3 text-[19px] leading-relaxed text-ink">{slide.body}</p>
        </div>
        <div className="mt-8 flex justify-center gap-2" aria-hidden>
          {SLIDES.map((_, n) => <span key={n} className={`h-2 rounded-full transition-all ${n === i ? "w-6 bg-brand" : "w-2 bg-line"}`} />)}
        </div>
        <div className="mt-5 grid grid-cols-[auto_1fr] gap-2.5">
          <button type="button" onClick={() => setI((n) => Math.max(0, n - 1))} disabled={i === 0} className="h-14 w-14 grid place-items-center rounded-2xl bg-surface border border-line disabled:opacity-30" aria-label="Back"><Icon name="back" /></button>
          {last ? (
            <button type="button" onClick={finish} className="h-14 rounded-2xl bg-brand text-white text-lg font-bold">Got it. Let&apos;s start</button>
          ) : (
            <button type="button" onClick={() => setI((n) => n + 1)} className="h-14 rounded-2xl bg-brand text-white text-lg font-bold flex items-center justify-center gap-2">Next <Icon name="arrow" size={20} /></button>
          )}
        </div>
        {last && <Link href="/methods" onClick={markWelcomeSeen} className="mt-2 min-h-11 grid place-items-center font-semibold text-brand underline underline-offset-2">Or read the safe methods first</Link>}
      </div>
    </div>
  );
}
