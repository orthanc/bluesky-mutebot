import { render } from 'preact-render-to-string';

export const MuteWords = ({ muteWords }: { muteWords: Array<string> }) => {
  return (
    <div id="mute-words" className="mt-4 relative" hx-indicator="#mute-words ">
      <div className="none htmx-request:absolute top-0 h-full w-full opacity-0" />
      <ul className="rounded-lg border-slate-300 border bg-slate-50 dark:bg-slate-950 htmx-request:animate-pulse">
        {muteWords.map((word) => (
          <li className="flex border-slate-300 border-b p-2 space-x-2 items-center">
            <div className="flex-grow">{word}</div>
            <div>
              <button
                name="unmuteWord"
                value={word}
                hx-post="/mutewords"
                className="rounded-full w-20 px-2 py-1 text-sm bg-slate-300 hover:bg-slate-400 dark:bg-slate-700 dark:hover:bg-slate-500"
              >
                Unmute
              </button>{' '}
            </div>
          </li>
        ))}
        <li className="p-2">
          <label id="word-to-mute-label" className="text-sm font-semibold">
            Mute word or phrase
          </label>
          <form hx-post="/mutewords" className="flex space-x-2 items-center">
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
      </ul>
    </div>
  );
};

export const renderMuteWords = (muteWords: Array<string>) =>
  render(<MuteWords muteWords={muteWords} />);
