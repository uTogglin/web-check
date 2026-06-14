import { Card } from 'client/components/Form/Card';
import Row, { ListRow } from 'client/components/Form/Row';

const IpWhoisCard = (props: { data: any; title: string; actionButtons: any }): JSX.Element => {
  const d = props.data;
  const cidr: string[] = d?.cidr ?? [];
  const status: string[] = d?.status ?? [];

  const rows = [
    { lbl: 'IP Address', val: d?.ip },
    { lbl: 'Organization', val: d?.organization },
    { lbl: 'Network Name', val: d?.name },
    { lbl: 'Handle', val: d?.handle },
    { lbl: 'Address Range', val: d?.range },
    { lbl: 'Network Type', val: d?.type },
    { lbl: 'Country', val: d?.country },
    { lbl: 'Registry', val: d?.registry },
    { lbl: 'Abuse Contact', val: d?.abuseContact },
    { lbl: 'Registered', val: d?.registered },
    { lbl: 'Updated', val: d?.updated },
  ].filter((r) => r.val);

  return (
    <Card heading={props.title} actionButtons={props.actionButtons}>
      {rows.map((r) => (
        <Row lbl={r.lbl} val={`${r.val}`} key={r.lbl} />
      ))}
      {cidr.length > 0 && <ListRow title="CIDR Blocks" list={cidr} />}
      {status.length > 0 && <ListRow title="Status" list={status} />}
    </Card>
  );
};

export default IpWhoisCard;
