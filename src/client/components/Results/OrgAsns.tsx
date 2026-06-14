import styled from '@emotion/styled';
import { Card } from 'client/components/Form/Card';
import colors from 'client/styles/colors';

const cardStyles = `small { opacity: 0.6; display: block; margin-bottom: 0.5rem; }`;

const AsnRow = styled.div`
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  padding: 0.35rem 0.25rem;
  &:not(:last-child) {
    border-bottom: 1px solid ${colors.primaryTransparent};
  }
  .asn {
    font-weight: 600;
    color: ${colors.primary};
    white-space: nowrap;
  }
  .holder {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .region {
    font-size: 0.75rem;
    color: ${colors.textColorSecondary};
    white-space: nowrap;
  }
`;

const Ownership = styled.div<{ owns: boolean }>`
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: 0.5rem;
  margin-bottom: 0.6rem;
  border-radius: 6px;
  border-left: 3px solid ${(p) => (p.owns ? colors.success : colors.warning)};
  background: ${colors.primaryTransparent};
  .verdict {
    font-weight: 600;
    color: ${(p) => (p.owns ? colors.success : colors.warning)};
  }
  .detail {
    font-size: 0.8rem;
    color: ${colors.textColorSecondary};
  }
`;

const IpOwnership = ({ o }: { o: any }) => {
  if (!o) return null;
  const registeredTo = o.org || o.netname || 'an unknown party';
  return (
    <Ownership owns={!!o.ownsOwnIp}>
      <span className="verdict">
        {o.ownsOwnIp ? '✅ Serves from its own IP space' : '❌ Does not own its serving IP'}
      </span>
      <span className="detail">
        {o.ip} is registered to {registeredTo}
        {o.netname && o.org ? ` (${o.netname})` : ''}
      </span>
    </Ownership>
  );
};

const OrgAsnsCard = (props: { data: any; title: string; actionButtons: any }): JSX.Element => {
  const d = props.data;
  const asns: any[] = d?.asns ?? [];
  const networks = d?.networks;
  const netList: any[] = networks?.list ?? [];

  return (
    <Card heading={props.title} actionButtons={props.actionButtons} styles={cardStyles}>
      <IpOwnership o={d?.ipOwnership} />

      {asns.length > 0 && (
        <>
          <small>
            {d?.total ?? asns.length} ASN{(d?.total ?? asns.length) === 1 ? '' : 's'} registered
            under a name matching &ldquo;{d?.brand}&rdquo;
            {d?.truncated ? ` (showing first ${asns.length})` : ''}
          </small>
          {asns.map((a, i) => (
            <AsnRow key={`org-asn-${a.asn}-${i}`} title={a.handle || ''}>
              <span className="asn">
                <a
                  href={`https://stat.ripe.net/AS${a.asn}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: colors.primary }}
                >
                  AS{a.asn}
                </a>
              </span>
              <span className="holder">{a.holder || a.handle || '—'}</span>
              {a.region && <span className="region">{a.region}</span>}
            </AsnRow>
          ))}
        </>
      )}

      {asns.length === 0 && netList.length > 0 && (
        <>
          <small>
            No ASN registered under &ldquo;{d?.brand}&rdquo; — found{' '}
            {networks?.count ?? netList.length} network block
            {(networks?.count ?? netList.length) === 1 ? '' : 's'} in the{' '}
            {d?.networkSource || 'RIR database'}
            {networks?.truncated ? ` (showing first ${netList.length})` : ''}
          </small>
          {netList.map((n, i) => (
            <AsnRow key={`org-net-${n.range}-${i}`} title={n.descr || n.type}>
              <span className="asn">{n.range}</span>
              <span className="holder">{n.netname || n.descr || '—'}</span>
              <span className="region">{n.type}</span>
            </AsnRow>
          ))}
        </>
      )}

      {asns.length === 0 && netList.length === 0 && (
        <small>No ASN or registered network block found under &ldquo;{d?.brand}&rdquo;.</small>
      )}
    </Card>
  );
};

export default OrgAsnsCard;
