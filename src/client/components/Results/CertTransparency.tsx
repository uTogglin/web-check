import { Card } from 'client/components/Form/Card';
import Row, { ExpandableRow, type RowProps } from 'client/components/Form/Row';
import Heading from 'client/components/Form/Heading';
import colors from 'client/styles/colors';

const certRows = (cert: any): RowProps[] =>
  [
    { lbl: 'Issuer', val: cert.issuer },
    { lbl: 'Valid From', val: cert.notBefore },
    { lbl: 'Valid To', val: cert.notAfter },
    { lbl: 'Logged At', val: cert.loggedAt },
    { lbl: 'Serial', val: cert.serial },
  ].filter((r) => r.val);

const CertTransparencyCard = (props: {
  data: any;
  title: string;
  actionButtons: any;
}): JSX.Element => {
  const ct = props.data;
  const issuers: Array<{ name: string; count: number }> = ct?.issuers ?? [];
  const recent: any[] = ct?.recentCerts ?? [];

  return (
    <Card heading={props.title} actionButtons={props.actionButtons}>
      <Row lbl="Total Certificates" val={`${ct?.totalCerts ?? 0}`} />
      <Row lbl="Currently Valid" val={`${ct?.currentlyValid ?? 0}`} />
      <Row
        lbl={`Issued (last ${ct?.recentWindowDays ?? 90} days)`}
        val={`${ct?.recentlyIssued ?? 0}`}
      />
      <Row lbl="Unique Issuers" val={`${ct?.uniqueIssuers ?? 0}`} />

      {issuers.length > 0 && (
        <>
          <Heading as="h4" size="small" align="left" color={colors.primary}>
            Issuing Authorities
          </Heading>
          {issuers.map((iss, i) => (
            <Row lbl={iss.name} val={`${iss.count}`} key={`issuer-${i}`} />
          ))}
        </>
      )}

      {recent.length > 0 && (
        <>
          <Heading as="h4" size="small" align="left" color={colors.primary}>
            Recent Certificates
          </Heading>
          {recent.map((cert, i) => (
            <ExpandableRow
              key={`cert-${cert.id ?? i}`}
              lbl={cert.commonName || cert.issuer || `Certificate #${i + 1}`}
              val={cert.notAfter ? `expires ${cert.notAfter}` : cert.issuer}
              rowList={certRows(cert)}
            />
          ))}
        </>
      )}
    </Card>
  );
};

export default CertTransparencyCard;
