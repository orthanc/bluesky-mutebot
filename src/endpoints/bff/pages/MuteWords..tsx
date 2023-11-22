import { render } from 'preact-render-to-string';

export const MuteWords = ({ muteWords }: { muteWords: Array<string> }) => {
  return (
    <div id="mute-words">
      <ul>
        {muteWords.map((word) => (
          <li>
            <button name="unmuteWord" value={word} hx-post="/mutewords">
              Unmute
            </button>{' '}
            {word}
          </li>
        ))}
      </ul>
      <form hx-post="/mutewords">
        <input type="text" name="muteWord" placeholder="word to mute" />
        <input type="submit" value="Mute" />
      </form>
    </div>
  );
};

export const renderMuteWords = (muteWords: Array<string>) =>
  render(<MuteWords muteWords={muteWords} />);
