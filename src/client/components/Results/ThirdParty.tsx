import styled from '@emotion/styled';
import { Card } from 'client/components/Form/Card';
import Row from 'client/components/Form/Row';
import Heading from 'client/components/Form/Heading';
import colors from 'client/styles/colors';

const CATEGORY_LABELS: Record<string, string> = {
  analytics: 'Analytics',
  advertising: 'Advertising',
  social: 'Social',
  'session-recording': 'Session Recording',
  'ab-testing': 'A/B Testing',
  marketing: 'Marketing',
  consent: 'Consent Mgmt',
  monitoring: 'Monitoring',
  support: 'Support / Chat',
  fonts: 'Fonts',
  media: 'Media',
  payments: 'Payments',
  security: 'Security',
  cdn: 'CDN',
  other: 'Other',
};

// Tracking categories get a "hot" colour, utility categories a calmer one
const CATEGORY_COLORS: Record<string, string> = {
  analytics: colors.warning,
  advertising: colors.danger,
  social: colors.danger,
  'session-recording': colors.danger,
  'ab-testing': colors.warning,
  marketing: colors.warning,
  consent: colors.warning,
  monitoring: colors.info,
  support: colors.info,
  fonts: colors.textColorSecondary,
  media: colors.info,
  payments: colors.success,
  security: colors.success,
  cdn: colors.textColorSecondary,
  other: colors.textColorSecondary,
};

const label = (cat: string) => CATEGORY_LABELS[cat] || cat;
const catColor = (cat: string) => CATEGORY_COLORS[cat] || colors.textColorSecondary;
// Google's favicon service resolves a logo for almost any domain (globe fallback)
const faviconFor = (domain: string) =>
  `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;

const DomainRow = styled.div`
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.4rem 0.25rem;
  &:not(:last-child) {
    border-bottom: 1px solid ${colors.primaryTransparent};
  }
  .logo {
    width: 24px;
    height: 24px;
    border-radius: 5px;
    background: ${colors.background};
    flex-shrink: 0;
    object-fit: contain;
  }
  .info {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
  }
  .domain {
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .provider {
    font-size: 0.75rem;
    color: ${colors.textColorSecondary};
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .badge {
    font-size: 0.7rem;
    font-weight: 600;
    padding: 0.1rem 0.45rem;
    border-radius: 99px;
    white-space: nowrap;
    border: 1px solid currentColor;
  }
  .count {
    font-size: 0.8rem;
    color: ${colors.textColorSecondary};
    min-width: 2.5rem;
    text-align: right;
    flex-shrink: 0;
  }
`;

// Hide the logo cleanly if even the favicon service fails to return an image
const onLogoError = (e: React.SyntheticEvent<HTMLImageElement>) => {
  e.currentTarget.style.visibility = 'hidden';
};

const ThirdPartyCard = (props: { data: any; title: string; actionButtons: any }): JSX.Element => {
  const d = props.data;
  const domains: any[] = d?.thirdPartyDomains ?? [];
  const categories: Record<string, number> = d?.categories ?? {};
  const sortedCats = Object.entries(categories).sort((a, b) => b[1] - a[1]);

  return (
    <Card heading={props.title} actionButtons={props.actionButtons}>
      <Row lbl="Third-Party Domains" val={`${d?.thirdPartyDomainCount ?? 0}`} />
      <Row
        lbl="Trackers Detected"
        val={`${d?.trackerCount ?? 0}`}
        title="Domains in analytics, advertising, social, marketing, session-recording, A/B or consent categories"
      />
      <Row
        lbl="Requests (3rd-party / total)"
        val={`${d?.thirdPartyRequests ?? 0} / ${d?.totalRequests ?? 0}`}
      />
      {d?.cookies && (
        <Row
          lbl="Cookies (1st / 3rd party)"
          val={`${d.cookies.firstParty} / ${d.cookies.thirdParty}`}
        />
      )}

      {sortedCats.length > 0 && (
        <>
          <Heading as="h4" size="small" align="left" color={colors.primary}>
            By Category
          </Heading>
          {sortedCats.map(([cat, n]) => (
            <Row lbl={label(cat)} val={`${n}`} key={`cat-${cat}`} />
          ))}
        </>
      )}

      {domains.length > 0 && (
        <>
          <Heading as="h4" size="small" align="left" color={colors.primary}>
            Third-Party Domains
          </Heading>
          {domains.map((dom, i) => (
            <DomainRow key={`tp-${dom.domain}-${i}`} title={`${dom.count} request(s)`}>
              <img
                className="logo"
                src={faviconFor(dom.domain)}
                alt=""
                loading="lazy"
                onError={onLogoError}
              />
              <div className="info">
                <span className="domain">{dom.domain}</span>
                <span className="provider">{dom.provider || 'Unknown service'}</span>
              </div>
              <span className="badge" style={{ color: catColor(dom.category) }}>
                {label(dom.category)}
              </span>
              <span className="count">{dom.count}×</span>
            </DomainRow>
          ))}
        </>
      )}

      {domains.length === 0 && <p>No third-party requests were observed on this page.</p>}
    </Card>
  );
};

export default ThirdPartyCard;
