export const MuteFor: preact.FunctionComponent<{
  name: string;
  showWhen?: string;
  selected?: string;
}> = ({ name, showWhen, selected }) => (
  <select
    {...(showWhen ? { 'x-show': showWhen } : {})}
    name={name}
    autoComplete="off"
    className="py-2 px-8 border rounded-lg dark:bg-slate-600"
  >
    {selected == null ? (
      <option value="null" selected>
        Mute for...
      </option>
    ) : null}
    {Object.entries({
      '1h': '1 hour',
      '3h': '3 hours',
      '12h': '12 hours',
      '1d': '1 day',
      '1w': '1 week',
      '1m': '1 month',
      '1y': '1 year',
      forever: 'forever',
    }).map(([value, display]) => (
      <option value={value} selected={value === selected}>
        {display}
      </option>
    ))}
  </select>
);
