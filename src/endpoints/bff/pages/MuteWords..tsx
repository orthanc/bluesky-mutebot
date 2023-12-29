export const MuteWord: preact.FunctionComponent<{ word: string }> = ({
  word,
}) => (
  <li className="flex border-slate-300 border-b p-2 space-x-2 items-center htmx-request:opacity-50">
    <div className="flex-grow">{word}</div>
    <div>
      <button
        name="unmuteWord"
        value={word}
        hx-post="/mutewords"
        className="rounded-full w-20 px-2 py-1 text-sm bg-slate-300 hover:bg-slate-400 dark:bg-slate-700 dark:hover:bg-slate-500 htmx-request:animate-pulse"
      >
        Unmute
      </button>{' '}
    </div>
  </li>
);

export const AddMuteWord: preact.FunctionComponent<{ oob?: boolean }> = ({
  oob,
}) => (
  <li
    className="p-2 htmx-request:animate-pulse"
    id="add-mute-word"
    {...(oob ? { 'hx-swap-oob': 'true' } : undefined)}
  >
    <label id="word-to-mute-label" className="text-sm font-semibold">
      Mute word or phrase
    </label>
    <form
      hx-post="/mutewords"
      className="flex space-x-2 items-center"
      hx-swap="afterend"
      hx-target="previous li"
    >
      <div className="flex-grow">
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
      <div>
        <input
          type="submit"
          value="Mute"
          className="rounded-full w-20 px-2 py-1 text-sm bg-bsky hover:bg-sky-500 text-white"
        />
      </div>
    </form>
  </li>
);

export const MuteWords = ({ muteWords }: { muteWords: Array<string> }) => {
  return (
    <div
      id="mute-words"
      className="mt-4 relative"
      hx-indicator="closest li"
      hx-target="closest li"
      hx-swap="delete"
    >
      <ul className="rounded-lg border-slate-300 border bg-slate-50 dark:bg-slate-950">
        <li className="hidden" />
        {muteWords.map((word) => (
          <MuteWord word={word} />
        ))}
        <AddMuteWord />
      </ul>
    </div>
  );
};
