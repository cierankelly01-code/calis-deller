import {
  TAG_LABELS,
  WEEKDAYS,
  formatMoney,
  formatQty,
  formatShortDay,
  weekdayIndex,
  type SupplierSpend,
  type WeekReport,
} from "@/lib/stock/ledger";

// The weekly summary is a prompt, not an AI feature: the owner copies it and
// pastes it into a chat with Claude. So it carries everything a sharp reader
// needs (numbers, context, what doesn't add up) as compact tables, ends with
// the questions worth answering, and leaves out staff names — who counted
// is irrelevant to what sells.

export type ShopWeek = { shopName: string; report: WeekReport; spend: SupplierSpend[] };

const cell = (text: string) => text.replace(/\|/g, "/").replace(/\s+/g, " ").trim();

function table(head: string[], rows: string[][]): string {
  return [
    `| ${head.join(" | ")} |`,
    `| ${head.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`),
  ].join("\n");
}

function trend(sold: number, avg: number | null): string {
  if (avg == null) return "new";
  if (avg === 0) return sold > 0 ? "up from 0" : "same";
  const pct = Math.round(((sold - avg) / avg) * 100);
  return pct === 0 ? "same" : `${pct > 0 ? "+" : ""}${pct}%`;
}

function shopSection({ shopName, report, spend }: ShopWeek): string {
  const out: string[] = [`## ${shopName}`];
  const spendTotal = spend.reduce((n, s) => n + s.total, 0);
  out.push(
    [
      `- Close counts done: ${report.countDays.length} of 7 days${report.countDays.length ? ` (${report.countDays.map((d) => WEEKDAYS[weekdayIndex(d)]).join(", ")})` : ""}`,
      `- Sales from tracked lines (sold × my sell price): ${formatMoney(report.totals.revenue)}`,
      `- Gross profit on those lines (sell − cost price): ${formatMoney(report.totals.profit)}`,
      `- Waste (binned × cost price): ${formatMoney(report.totals.wasteCost)}`,
      `- Delivery invoices this week: ${spend.length ? `${formatMoney(spendTotal)} (${spend.map((s) => `${s.supplier} ${formatMoney(s.total)}`).join(", ")})` : "none recorded"}`,
      report.unpriced.length ? `- Sold but no sell price set yet: ${report.unpriced.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("\n")
  );

  if (report.products.length === 0) {
    out.push("_No stock counts for this week._");
    return out.join("\n\n");
  }

  out.push(
    "### By product (best profit first)\n" +
      table(
        ["Product", "Sold", "Sales", "Profit", "Margin", "Binned", "Waste", "Sold out", "vs avg of last 4 wks"],
        report.products.map((p) => [
          p.productName,
          formatQty(p.sold, p.unit),
          p.revenue == null ? "no price" : formatMoney(p.revenue),
          p.profit == null ? "–" : formatMoney(p.profit),
          p.margin == null ? "–" : `${p.margin}%`,
          p.binned ? formatQty(p.binned, p.unit) : "0",
          p.wasteCost == null ? "–" : formatMoney(p.wasteCost),
          p.soldOuts.length ? p.soldOuts.map((s) => `${WEEKDAYS[weekdayIndex(s.date)]} ${s.time}`).join(", ") : "–",
          trend(p.sold, p.prevWeeksAvg),
        ])
      )
  );

  out.push(
    "### Sold per day (night-to-night counts; – = no figure)\n" +
      table(
        ["Product", ...WEEKDAYS],
        report.products.map((p) => [p.productName, ...p.byWeekday.map((v) => (v == null ? "–" : formatQty(v, p.unit)))])
      )
  );

  if (report.notes.length) {
    out.push(
      "### What the days were like\n" +
        report.notes
          .map((n) => `- ${formatShortDay(n.date)}: ${[...n.tags.map((t) => TAG_LABELS[t]?.replace(/^\S+\s/, "") ?? t), n.note ? `“${n.note}”` : ""].filter(Boolean).join(", ")}`)
          .join("\n")
    );
  }

  const checks = report.products.flatMap((p) => p.checks.map((c) => `- ${p.productName} — ${c}`));
  if (checks.length) out.push("### Figures that don't add up\n" + checks.join("\n"));
  return out.join("\n\n");
}

export function buildSummaryPrompt(shops: ShopWeek[], businessName = "Kelly's Deli"): string {
  const { from, to, through } = shops[0].report;
  const period = through < to ? `the week so far, ${formatShortDay(from)} – ${formatShortDay(through)} (the week isn't over yet; comparisons are with the same days of earlier weeks)` : `the week ${formatShortDay(from)} – ${formatShortDay(to)}`;
  const parts: string[] = [
    `I run ${businessName}, a deli with ${shops.length === 1 ? "one shop" : `${shops.length} shops (${shops.map((s) => s.shopName).join(" and ")})`}. Below is my stock data for ${period}, from my stock-tracking app.`,
    [
      "How the numbers work:",
      "- I do a close count every night. Sold = last night's count + what came in − what was binned − what's left now.",
      "- Loose counter food (ham, turkey, salads…) is in kg; everything else is items.",
      "- Prices are my own per-unit cost and sell prices. My till is an old one with no item-level sales, so these counts are the only sales record by product.",
      "- \"Sold out\" is the time we ran out that day. It means demand was higher than the count shows.",
      "- Only the lines I track are here, so the totals aren't the whole shop's takings.",
    ].join("\n"),
    ...shops.map(shopSection),
  ];

  if (shops.length > 1) {
    const names = [...new Set(shops.flatMap((s) => s.report.products.map((p) => p.productName)))].sort();
    parts.push(
      "## Both shops side by side (sold this week)\n" +
        table(
          ["Product", ...shops.map((s) => s.shopName)],
          names.map((name) => [
            name,
            ...shops.map((s) => {
              const p = s.report.products.find((x) => x.productName === name);
              return p ? formatQty(p.sold, p.unit) : "–";
            }),
          ])
        )
    );
  }

  const questions = [
    "What should I make or order more of, and less of, and on which days?",
    "Where am I losing money: waste, low margins, or selling out too early?",
    "Any prices worth changing, up or down?",
    ...(shops.length > 1 ? ["Differences between the shops I should act on."] : []),
    "Anything in the data that looks wrong or worth checking.",
  ];
  parts.push(
    "## What I want from you\n" +
      questions.map((q, i) => `${i + 1}. ${q}`).join("\n") +
      "\n\nUse the actual numbers, be specific, and finish with a short action list for next week. Ask me if you need anything that isn't here."
  );
  return parts.join("\n\n");
}
