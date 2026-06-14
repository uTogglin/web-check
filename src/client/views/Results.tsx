import { useState, useEffect, useMemo, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import styled from '@emotion/styled';
import { ToastContainer } from 'react-toastify';

import colors from 'client/styles/colors';
import Heading from 'client/components/Form/Heading';
import Modal from 'client/components/Form/Modal';
import Footer from 'client/components/misc/Footer';
import Nav from 'client/components/Form/Nav';
import Loader from 'client/components/misc/Loader';
import ErrorBoundary from 'client/components/misc/ErrorBoundary';
import DocContent from 'client/components/misc/DocContent';
import ProgressBar, {
  type LoadingJob,
  type LoadingState,
} from 'client/components/misc/ProgressBar';
import ActionButtons from 'client/components/misc/ActionButtons';
import AdditionalResources from 'client/components/misc/AdditionalResources';
import AdvisoryPanel from 'client/components/misc/AdvisoryPanel';
import NoResults from 'client/components/misc/NoResults';
import ResultsMasonryGrid from 'client/components/misc/ResultsMasonryGrid';
import ResultSection from 'client/components/misc/ResultSection';
import ViewRaw from 'client/components/misc/ViewRaw';

import { determineAddressType, type AddressType } from 'client/utils/address-type-checker';
import { hasData } from 'client/utils/result-processor';
import keys from 'client/utils/get-keys';
import useJobs from 'client/hooks/useJobs';
import { jobs, allCards, allCardIds } from 'client/jobs/registry';
import { runAnalysis } from 'client/analysis/registry';

const ResultsOuter = styled.div`
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding-top: 1rem;
`;

const ResultsContent = styled.section`
  width: 95vw;
  margin: 0 auto;
  @keyframes cardFlash {
    0%,
    30% {
      outline: 2px solid ${colors.primary};
      outline-offset: 4px;
    }
    100% {
      outline: 2px solid transparent;
      outline-offset: 4px;
    }
  }
  .flash > section {
    animation: cardFlash 1.2s ease-out;
    border-radius: 8px;
  }
`;

// Group the result cards into collapsible sections. Order here is the display order;
// any card id not listed falls through to the "Other" section so nothing is hidden.
const SECTIONS: { id: string; title: string; ids: string[] }[] = [
  {
    id: 'server',
    title: 'Server & Infrastructure',
    ids: ['status', 'server-info', 'dns-server', 'location', 'ports', 'hosts', 'trace-route', 'carbon'],
  },
  {
    id: 'domain',
    title: 'Domain & Registration',
    ids: ['domain', 'whois', 'subdomains', 'archives', 'rank'],
  },
  {
    id: 'dns',
    title: 'DNS & Email',
    ids: ['dns', 'dnssec', 'txt-records', 'caa', 'mail-config', 'email-security'],
  },
  {
    id: 'security',
    title: 'Security',
    ids: [
      'http-security',
      'hsts',
      'threats',
      'firewall',
      'block-lists',
      'security-txt',
      'cookies',
      'headers',
      'third-party',
    ],
  },
  {
    id: 'ssl',
    title: 'SSL / TLS',
    ids: ['ssl', 'tls-connection', 'tls-security-audit', 'cert-transparency'],
  },
  { id: 'network', title: 'Network & Routing', ids: ['ip-whois', 'asn', 'org-asns'] },
  { id: 'compatibility', title: 'Compatibility & Tech', ids: ['tls-client-compat', 'tech-stack'] },
  {
    id: 'content',
    title: 'SEO & Content',
    ids: ['social-tags', 'sitemap', 'robots-txt', 'linked-pages', 'redirects', 'quality', 'screenshot'],
  },
];

const OTHER_SECTION = 'other';

// cardId -> sectionId lookup, built once
const CARD_SECTION: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const sec of SECTIONS) for (const id of sec.ids) map[id] = sec.id;
  return map;
})();

const makeSiteName = (address: string): string => {
  try {
    const withScheme = /^https?:\/\//i.test(address) ? address : `https://${address}`;
    return new URL(withScheme).hostname.replace(/^www\./, '');
  } catch {
    return address;
  }
};

const makeActionButtons = (title: string, refresh: () => void, showInfo: () => void): ReactNode => (
  <ActionButtons
    actions={[
      { label: `Info about ${title}`, onClick: showInfo, icon: 'ⓘ' },
      { label: `Re-fetch ${title} data`, onClick: refresh, icon: '↻' },
    ]}
  />
);

const Results = (props: { address?: string }): JSX.Element => {
  const address = props.address || useParams().urlToScan || '';
  const [addressType, setAddressType] = useState<AddressType>('empt');
  const [modalOpen, setModalOpen] = useState(false);
  const [modalContent, setModalContent] = useState<ReactNode>(<></>);
  // Sections are open by default; ids land here only when explicitly collapsed
  const [closedSections, setClosedSections] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (addressType === 'empt') setAddressType(determineAddressType(address));
  }, [address, addressType]);

  const { state: jobsState, retry, ipLookupError } = useJobs(address, addressType, jobs);

  // Shape useJobs state for the existing ProgressBar contract
  const loadingJobs: LoadingJob[] = useMemo(
    () =>
      allCardIds.map((id) => {
        const e = jobsState[id] || { state: 'loading' as LoadingState };
        return {
          name: id,
          state: e.state,
          error: e.error,
          timeTaken: e.timeTaken,
          retry: () => retry(id),
        };
      }),
    [jobsState, retry],
  );

  // Expose successful job results on window.webCheck for debugging,
  // resetting on new input so prior scans cannot accumulate
  useEffect(() => {
    (window as any).webCheck = {};
  }, [address]);
  useEffect(() => {
    const w = (window as any).webCheck;
    if (!w) return;
    Object.entries(jobsState).forEach(([id, entry]) => {
      if (entry?.state === 'success' && entry.raw !== undefined) {
        w[id] = entry.raw;
      }
    });
  }, [jobsState]);

  const showInfo = (id: string) => {
    setModalContent(DocContent(id));
    setModalOpen(true);
  };

  const showErrorModal = (content: ReactNode) => {
    setModalContent(content);
    setModalOpen(true);
  };

  // Resolve each card's data, applying picker and falling back when needed
  const renderable = allCards.map(({ jobId, card }) => {
    const entry = jobsState[card.id];
    const raw = entry?.raw;
    let data = raw && card.pick ? card.pick(raw) : raw;
    if (!hasData(data) && card.fallback) data = card.fallback(jobsState);
    return { jobId, card, data, entry };
  });

  const cardsToShow = renderable.filter(({ data, entry }) => hasData(data) && !entry?.error);

  // Bucket visible cards into their sections, preserving SECTIONS order; drop empty sections
  const sectionedCards = [...SECTIONS, { id: OTHER_SECTION, title: 'Other', ids: [] }]
    .map((sec) => ({
      ...sec,
      cards: cardsToShow.filter(({ card }) => (CARD_SECTION[card.id] || OTHER_SECTION) === sec.id),
    }))
    .filter((sec) => sec.cards.length > 0);

  const toggleSection = (id: string) =>
    setClosedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const findings = useMemo(() => runAnalysis(jobsState), [jobsState]);

  // Detect a catastrophic API outage when the bulk of settled jobs error or time out
  const apiUnreachable = useMemo(() => {
    const entries = Object.values(jobsState);
    const settled = entries.filter((e) => e?.state !== 'loading');
    const dead = settled.filter((e) => e?.state === 'error' || e?.state === 'timed-out');
    return settled.length >= entries.length / 2 && dead.length / settled.length >= 0.9;
  }, [jobsState]);

  // Pick the highest-priority error state, if any
  let errorKind: 'invalid' | 'unreachable' | 'api-down' | 'disabled' | null = null;
  if (keys.disableEverything) {
    errorKind = 'disabled';
  } else if (addressType === 'err') {
    errorKind = 'invalid';
  } else if (ipLookupError) {
    errorKind = 'unreachable';
  } else if (apiUnreachable) {
    errorKind = 'api-down';
  }

  const jumpToCard = (id: string) => {
    // Make sure the card's section is expanded before we try to scroll to it
    const sectionId = CARD_SECTION[id] || OTHER_SECTION;
    setClosedSections((prev) => {
      if (!prev.has(sectionId)) return prev;
      const next = new Set(prev);
      next.delete(sectionId);
      return next;
    });
    requestAnimationFrame(() => {
      const el = document.getElementById(`card-${id}`);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      el.classList.remove('flash');
      void el.offsetWidth;
      el.classList.add('flash');
      window.setTimeout(() => el.classList.remove('flash'), 1300);
    });
  };

  return (
    <ResultsOuter>
      <Nav>
        {address && (
          <Heading color={colors.textColor} size="medium">
            {addressType === 'url' && (
              <a
                target="_blank"
                rel="noreferrer"
                href={/^https?:\/\//i.test(address) ? address : `https://${address}`}
              >
                <img width="32px" alt="" src={`https://icon.horse/icon/${makeSiteName(address)}`} />
              </a>
            )}
            {makeSiteName(address)}
          </Heading>
        )}
      </Nav>
      {errorKind && <NoResults kind={errorKind} address={address} error={ipLookupError} />}
      <ProgressBar loadStatus={loadingJobs} showModal={showErrorModal} showJobDocs={showInfo} />
      <Loader show={loadingJobs.filter((j) => j.state !== 'loading').length < 5} />
      <AdvisoryPanel findings={findings} onJumpTo={jumpToCard} />
      <ResultsContent>
        {sectionedCards.map((section) => (
          <ResultSection
            key={section.id}
            id={section.id}
            title={section.title}
            count={section.cards.length}
            open={!closedSections.has(section.id)}
            onToggle={() => toggleSection(section.id)}
          >
            <ResultsMasonryGrid minColWidth={336}>
              {section.cards.map(({ card, data }) => (
                <div id={`card-${card.id}`} key={`eb-${card.id}`}>
                  <ErrorBoundary title={card.title}>
                    <card.Component
                      key={card.id}
                      data={data}
                      title={card.title}
                      actionButtons={makeActionButtons(
                        card.title,
                        () => retry(card.id),
                        () => showInfo(card.id),
                      )}
                    />
                  </ErrorBoundary>
                </div>
              ))}
            </ResultsMasonryGrid>
          </ResultSection>
        ))}
      </ResultsContent>
      <ViewRaw
        everything={renderable.map((r) => ({
          id: r.card.id,
          title: r.card.title,
          result: r.data,
        }))}
      />
      <AdditionalResources url={address} />

      <Modal isOpen={modalOpen} closeModal={() => setModalOpen(false)}>
        {modalContent}
      </Modal>
      <ToastContainer
        limit={3}
        draggablePercent={60}
        autoClose={2500}
        theme="dark"
        position="bottom-right"
      />
      <Footer />
    </ResultsOuter>
  );
};

export default Results;
