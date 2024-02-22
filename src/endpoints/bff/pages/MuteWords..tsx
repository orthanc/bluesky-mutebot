import classNames from 'classnames';
import { MutedWord } from '../../../muteWordsStore';

const MuteFor: preact.FunctionComponent<{
  showWhen?: string;
  selected?: string;
}> = ({ showWhen, selected }) => (
  <select
    {...(showWhen ? { 'x-show': showWhen } : {})}
    name="muteUntil"
    autoComplete="off"
    className="py-2 px-8 border rounded-lg"
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

export const MuteWord: preact.FunctionComponent<{
  muteWord: MutedWord;
  now: string;
}> = ({ muteWord, now }) => {
  const expired = !muteWord.forever && muteWord.muteUntil < now;
  return (
    <>
      <div
        className={classNames(
          'flex-grow flex-shrink text-ellipsis overflow-x-hidden',
          {
            'text-gray-500': expired,
          }
        )}
      >
        {muteWord.word}
      </div>
      <div x-data={JSON.stringify({ ...muteWord, editUntil: false })}>
        <div
          x-show="!editUntil"
          x-on:click="editUntil = !editUntil"
          className="text-xs text-gray-500 underline cursor-pointer"
        >
          {muteWord.forever ? (
            <>muted forever</>
          ) : expired ? (
            <>mute expired</>
          ) : (
            <>
              <div>muted until </div>
              <div x-text="dateFns.formatRelative(dateFns.parseISO(muteUntil), now)" />
            </>
          )}
        </div>
        <form hx-post="/mutewords" hx-trigger="change">
          <input type="hidden" name="muteWord" value={muteWord.word} />
          <MuteFor showWhen="editUntil" />
        </form>
      </div>
      <div>
        <button
          name="unmuteWord"
          value={muteWord.word}
          hx-post="/mutewords"
          hx-swap="delete"
          className="rounded-full w-20 px-2 py-1 text-sm bg-slate-300 hover:bg-slate-400 dark:bg-slate-700 dark:hover:bg-slate-500 htmx-request:animate-pulse"
        >
          {expired ? 'Remove' : 'Unmute'}
        </button>{' '}
      </div>
    </>
  );
};

export const MuteWordListItem: preact.FunctionComponent = ({ children }) => (
  <li className="flex border-slate-300 border-b p-2 space-x-2 items-center htmx-request:opacity-50">
    {children}
  </li>
);

export const AddMuteWord: preact.FunctionComponent<{
  oob?: boolean;
  muteUntil?: string;
}> = ({ oob, muteUntil }) => (
  <div
    className="p-2 rounded-b-lg border-t-0 border-slate-300 border bg-slate-50 dark:bg-slate-950 htmx-request:animate-pulse"
    id="add-mute-word"
    hx-indicator="this"
    {...(oob ? { 'hx-swap-oob': 'true' } : undefined)}
  >
    <label id="word-to-mute-label" className="text-sm font-semibold">
      Mute word or phrase
    </label>
    <form
      hx-post="/mutewords"
      hx-swap="beforeend"
      hx-target="#muteWords"
      className="space-y-2"
    >
      <div>
        <input
          label="word-to-mute-label"
          type="text"
          name="muteWord"
          placeholder="word or phrase to mute"
          autoComplete="off"
          autoFocus={true}
          className="w-full rounded-lg border border-slate-400 dark:bg-slate-600 p-1"
        />
      </div>
      <div className="flex space-x-2 items-center">
        <div className="flex-grow">
          <MuteFor selected={muteUntil} />
        </div>
        <div>
          <input type="hidden" name="addMuteWord" value="true" />
          <input
            type="submit"
            value="Mute"
            className="rounded-full w-20 px-2 py-1 text-sm bg-bsky hover:bg-sky-500 text-white"
          />
        </div>
      </div>
    </form>
  </div>
);

export const MuteWords = ({
  muteWords,
  now,
}: {
  muteWords: Array<MutedWord>;
  now: string;
}) => {
  return (
    <div
      id="mute-words"
      className="mt-4 relative"
      hx-indicator="closest li"
      hx-target="closest li"
      x-data={JSON.stringify({ now })}
      x-show="true"
      x-cloak
    >
      <ul
        className="rounded-t-lg border-slate-300 border border-b-0 bg-slate-50 dark:bg-slate-950"
        id="muteWords"
      >
        {muteWords.map((muteWord) => (
          <MuteWordListItem>
            <MuteWord muteWord={muteWord} now={now} />
          </MuteWordListItem>
        ))}
      </ul>
      <AddMuteWord muteUntil="forever" />
    </div>
  );
};
