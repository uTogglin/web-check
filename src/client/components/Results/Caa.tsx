import { Card } from 'client/components/Form/Card';
import Row, { ListRow } from 'client/components/Form/Row';

const CaaCard = (props: { data: any; title: string; actionButtons: any }): JSX.Element => {
  const caa = props.data;
  const issuers: string[] = caa?.issuers ?? [];
  const wildcardIssuers: string[] = caa?.wildcardIssuers ?? [];
  const iodef: string[] = caa?.iodef ?? [];

  return (
    <Card heading={props.title} actionButtons={props.actionButtons}>
      <Row lbl="CAA Records Present?" val={caa?.hasCaa ? '✅ Yes' : '❌ No'} />
      {caa?.hasCaa && (
        <Row lbl="Issuance Restricted?" val={caa?.isEnforced ? '✅ Yes' : '❌ No'} />
      )}
      {caa?.inheritedFrom && <Row lbl="Inherited From" val={caa.inheritedFrom} />}

      {issuers.length > 0 && <ListRow title="Allowed Issuers" list={issuers} />}
      {wildcardIssuers.length > 0 && (
        <ListRow title="Allowed Wildcard Issuers" list={wildcardIssuers} />
      )}
      {iodef.length > 0 && <ListRow title="Violation Reporting (iodef)" list={iodef} />}

      {!caa?.hasCaa && (
        <p>
          No CAA records found. Any certificate authority is permitted to issue certificates for
          this domain. Adding a CAA record restricts issuance to authorities you trust.
        </p>
      )}
    </Card>
  );
};

export default CaaCard;
