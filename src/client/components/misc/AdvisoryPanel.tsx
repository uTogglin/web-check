import { useMemo, useState, type ReactNode } from 'react';
import styled from '@emotion/styled';
import colors from 'client/styles/colors';
import Card from 'client/components/Form/Card';
import Heading from 'client/components/Form/Heading';
import { allCards } from 'client/jobs/registry';
import type { Finding, Severity } from 'client/analysis/types';

/* -------------------------------------------------------------------------- */
/*  Severity + category metadata                                              */
/* -------------------------------------------------------------------------- */

const ORDER: Severity[] = ['critical', 'issue', 'warning', 'info', 'pass'];

interface SevMeta {
  label: string;
  color: string;
  glyph: string;
}

const META: Record<Severity, SevMeta> = {
  critical: { label: 'Critical', color: colors.danger, glyph: '✕' },
  issue: { label: 'Issues', color: colors.error, glyph: '!' },
  warning: { label: 'Warnings', color: colors.warning, glyph: '△' },
  info: { label: 'Informational', color: colors.info, glyph: 'ⓘ' },
  pass: { label: 'Passes', color: colors.success, glyph: '✓' },
};

// Each finding earns credit toward its category score; info is neutral
const SEV_WEIGHT: Record<Severity, number | null> = {
  pass: 1,
  warning: 0.5,
  info: null,
  issue: 0,
  critical: 0,
};

// Web-Check tags every card with one or more of these domains
const CATEGORIES: { tag: string; label: string; blurb: string }[] = [
  { tag: 'security', label: 'Security', blurb: 'TLS, headers, threats & hardening' },
  { tag: 'server', label: 'Server', blurb: 'Infrastructure, DNS & network' },
  { tag: 'client', label: 'Front-End', blurb: 'Cookies, trackers & page assets' },
  { tag: 'meta', label: 'SEO & Meta', blurb: 'Crawlability, ranking & metadata' },
];

// cardId -> { tags, title } lookup, built once from the registry
const CARD_INFO: Record<string, { tags: string[]; title: string }> = (() => {
  const map: Record<string, { tags: string[]; title: string }> = {};
  for (const { card } of allCards) map[card.id] = { tags: card.tags || [], title: card.title };
  return map;
})();

const scoreColor = (score: number | null): string => {
  if (score === null) return colors.textColorSecondary;
  if (score >= 90) return colors.primary;
  if (score >= 50) return colors.error;
  return colors.danger;
};

const scoreOf = (findings: Finding[]): number | null => {
  let earned = 0;
  let total = 0;
  for (const f of findings) {
    const w = SEV_WEIGHT[f.severity];
    if (w === null) continue;
    earned += w;
    total += 1;
  }
  return total === 0 ? null : Math.round((earned / total) * 100);
};

const grade = (score: number | null): string => {
  if (score === null) return '–';
  if (score >= 95) return 'A+';
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 50) return 'D';
  return 'F';
};

/* -------------------------------------------------------------------------- */
/*  Styled                                                                     */
/* -------------------------------------------------------------------------- */

const Wrapper = styled(Card)`
  margin: 0 auto;
  width: 95vw;
  max-height: 100%;
`;

const TopRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  align-items: stretch;
  margin-bottom: 1.25rem;
`;

const Overall = styled.div`
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem 1.25rem;
  background: ${colors.background};
  border: 1px solid ${colors.primaryTransparent};
  border-radius: 10px;
  min-width: 15rem;
  .meta {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .meta .g {
    font-size: 1.6rem;
    font-weight: 800;
    line-height: 1;
  }
  .meta .lbl {
    font-size: 0.85rem;
    color: ${colors.textColor};
  }
  .meta .sub {
    font-size: 0.72rem;
    color: ${colors.textColorSecondary};
  }
`;

const TileGrid = styled.div`
  flex: 1;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
  gap: 0.75rem;
`;

const Tile = styled.button<{ active: boolean }>`
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.65rem 0.8rem;
  background: ${(p) => (p.active ? colors.primaryTransparent : colors.background)};
  border: 1px solid ${(p) => (p.active ? colors.primary : colors.primaryTransparent)};
  border-radius: 10px;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  color: ${colors.textColor};
  transition:
    transform 0.15s ease,
    border-color 0.15s ease;
  &:hover {
    transform: translateY(-2px);
    border-color: ${colors.primary};
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    overflow: hidden;
  }
  .body .lbl {
    font-size: 0.85rem;
    font-weight: 600;
    white-space: nowrap;
  }
  .body .sub {
    font-size: 0.68rem;
    color: ${colors.textColorSecondary};
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
`;

const Tally = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 1.25rem;
`;

const TallyPill = styled.span<{ color: string }>`
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.3rem 0.7rem;
  border-radius: 999px;
  font-size: 0.8rem;
  color: ${(p) => p.color};
  background: ${(p) => `${p.color}14`};
  border: 1px solid ${(p) => `${p.color}55`};
  .n {
    font-weight: 700;
  }
`;

const BreakdownTitle = styled.h4`
  margin: 0 0 0.25rem 0;
  font-size: 1rem;
  color: ${colors.primary};
`;

const BreakdownSub = styled.p`
  margin: 0 0 0.75rem 0;
  font-size: 0.75rem;
  color: ${colors.textColorSecondary};
`;

const Accordion = styled.div`
  border: 1px solid ${colors.primaryTransparent};
  border-radius: 8px;
  overflow: hidden;
  &:not(:last-child) {
    margin-bottom: 0.6rem;
  }
`;

const AccHead = styled.button<{ open: boolean }>`
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.7rem 0.9rem;
  background: ${(p) => (p.open ? colors.primaryTransparent : 'transparent')};
  border: none;
  cursor: pointer;
  color: ${colors.textColor};
  font-size: 0.95rem;
  font-family: inherit;
  text-align: left;
  transition: background 0.15s ease;
  &:hover {
    background: ${colors.primaryTransparent};
  }
  .name {
    font-weight: 600;
  }
  .mini {
    display: flex;
    gap: 0.45rem;
    margin-left: 0.25rem;
  }
  .mini span {
    font-size: 0.74rem;
    color: ${colors.textColorSecondary};
  }
`;

const Badge = styled.span<{ color: string }>`
  font-size: 0.8rem;
  font-weight: 800;
  color: ${(p) => p.color};
  border: 1px solid ${(p) => p.color};
  border-radius: 999px;
  padding: 0.05rem 0.55rem;
  min-width: 2.4rem;
  text-align: center;
  flex-shrink: 0;
`;

const Chevron = styled.span<{ open: boolean }>`
  margin-left: auto;
  color: ${colors.primary};
  transition: transform 0.2s ease;
  transform: rotate(${(p) => (p.open ? 90 : 0)}deg);
`;

const FindingList = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  background: ${colors.background};
`;

const FindingItem = styled.li`
  display: grid;
  grid-template-columns: 1.25rem 1fr auto;
  gap: 0.6rem;
  align-items: baseline;
  padding: 0.45rem 0.9rem;
  border-top: 1px dashed ${colors.primaryTransparent};
  .glyph {
    font-weight: 700;
    text-align: center;
    align-self: center;
  }
  .jump {
    background: none;
    border: none;
    color: ${colors.textColor};
    font-family: inherit;
    font-size: 0.88rem;
    padding: 0;
    text-align: left;
    cursor: pointer;
    &:hover,
    &:focus-visible {
      color: ${colors.primary};
      outline: none;
    }
  }
  .detail {
    display: block;
    color: ${colors.textColorSecondary};
    font-size: 0.76rem;
    margin-top: 0.1rem;
  }
  .src {
    font-size: 0.7rem;
    color: ${colors.textColorSecondary};
    white-space: nowrap;
    align-self: center;
  }
`;

/* -------------------------------------------------------------------------- */
/*  Sub-components                                                             */
/* -------------------------------------------------------------------------- */

const Gauge = ({ score, size = 56 }: { score: number | null; size?: number }): JSX.Element => {
  const color = scoreColor(score);
  const r = size / 2 - 5;
  const c = 2 * Math.PI * r;
  const offset = c - ((score ?? 0) / 100) * c;
  const mid = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
      <circle cx={mid} cy={mid} r={r} fill="none" stroke={colors.backgroundLighter} strokeWidth="5" />
      <circle
        cx={mid}
        cy={mid}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${mid} ${mid})`}
        style={{ transition: 'stroke-dashoffset 0.6s ease' }}
      />
      <text
        x={mid}
        y={mid}
        dominantBaseline="central"
        textAnchor="middle"
        fill={color}
        fontSize={size * 0.28}
        fontWeight="700"
      >
        {score === null ? '–' : score}
      </text>
    </svg>
  );
};

/* -------------------------------------------------------------------------- */
/*  Main panel                                                                 */
/* -------------------------------------------------------------------------- */

interface Props {
  findings: Finding[];
  onJumpTo: (cardId: string) => void;
}

const AdvisoryPanel = ({ findings, onJumpTo }: Props): ReactNode => {
  // Per-category findings, scores and severity tallies derived from local analysis
  const { categories, tally, overall } = useMemo(() => {
    const tally: Record<Severity, number> = {
      critical: 0,
      issue: 0,
      warning: 0,
      info: 0,
      pass: 0,
    };
    for (const f of findings) tally[f.severity] += 1;

    const categories = CATEGORIES.map((cat) => {
      const items = findings
        .filter((f) => CARD_INFO[f.cardId]?.tags.includes(cat.tag))
        .sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity));
      const counts: Record<Severity, number> = {
        critical: 0,
        issue: 0,
        warning: 0,
        info: 0,
        pass: 0,
      };
      for (const f of items) counts[f.severity] += 1;
      const flagged = counts.critical + counts.issue + counts.warning;
      return { ...cat, items, counts, flagged, score: scoreOf(items) };
    }).filter((c) => c.items.length > 0);

    return { categories, tally, overall: scoreOf(findings) };
  }, [findings]);

  // Open categories that have something actionable by default
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const isOpen = (tag: string, flagged: number) =>
    open[tag] !== undefined ? open[tag] : flagged > 0;
  const toggle = (tag: string, flagged: number) =>
    setOpen((o) => ({ ...o, [tag]: !(o[tag] !== undefined ? o[tag] : flagged > 0) }));

  if (!findings.length) return null;

  return (
    <Wrapper>
      <Heading as="h2" align="left" color={colors.primary}>
        Site Health
      </Heading>

      {/* Overall grade + per-category score tiles */}
      <TopRow>
        <Overall>
          <Gauge score={overall} size={68} />
          <div className="meta">
            <span className="g" style={{ color: scoreColor(overall) }}>
              {grade(overall)}
            </span>
            <span className="lbl">Overall score</span>
            <span className="sub">{findings.length} checks analysed locally</span>
          </div>
        </Overall>
        <TileGrid>
          {categories.map((cat) => (
            <Tile
              key={cat.tag}
              active={isOpen(cat.tag, cat.flagged)}
              onClick={() => toggle(cat.tag, cat.flagged)}
              title={`${cat.label}: ${cat.blurb}`}
            >
              <Gauge score={cat.score} />
              <div className="body">
                <span className="lbl">{cat.label}</span>
                <span className="sub">
                  {cat.flagged > 0 ? `${cat.flagged} to review` : 'All clear'}
                </span>
              </div>
            </Tile>
          ))}
        </TileGrid>
      </TopRow>

      {/* Severity tally */}
      <Tally>
        {ORDER.filter((s) => tally[s] > 0).map((s) => (
          <TallyPill key={s} color={META[s].color}>
            <span>{META[s].glyph}</span>
            <span className="n">{tally[s]}</span>
            {META[s].label}
          </TallyPill>
        ))}
      </Tally>

      {/* Expandable breakdown — every finding, grouped by category */}
      <BreakdownTitle>Detailed Breakdown</BreakdownTitle>
      <BreakdownSub>Expand a category to review every individual check behind its score</BreakdownSub>
      {categories.map((cat) => {
        const opened = isOpen(cat.tag, cat.flagged);
        return (
          <Accordion key={cat.tag}>
            <AccHead open={opened} onClick={() => toggle(cat.tag, cat.flagged)} aria-expanded={opened}>
              <Badge color={scoreColor(cat.score)}>{cat.score === null ? '–' : cat.score}</Badge>
              <span className="name">{cat.label}</span>
              <span className="mini">
                {ORDER.filter((s) => cat.counts[s] > 0).map((s) => (
                  <span key={s} style={{ color: META[s].color }}>
                    {cat.counts[s]} {META[s].glyph}
                  </span>
                ))}
              </span>
              <Chevron open={opened}>▶</Chevron>
            </AccHead>
            {opened && (
              <FindingList>
                {cat.items.map((f, i) => {
                  const m = META[f.severity];
                  return (
                    <FindingItem key={`${f.cardId}-${i}`}>
                      <span className="glyph" style={{ color: m.color }} aria-label={m.label}>
                        {m.glyph}
                      </span>
                      <span>
                        <button type="button" className="jump" onClick={() => onJumpTo(f.cardId)}>
                          {f.title}
                        </button>
                        {f.detail && <span className="detail">{f.detail}</span>}
                      </span>
                      <span className="src">{CARD_INFO[f.cardId]?.title || f.cardId}</span>
                    </FindingItem>
                  );
                })}
              </FindingList>
            )}
          </Accordion>
        );
      })}
    </Wrapper>
  );
};

export default AdvisoryPanel;
