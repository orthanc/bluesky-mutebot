import { render } from 'preact-render-to-string';

export const MuteWords = ({ muteWords }: { muteWords: Array<string> }) => {
  return (
    <div id="mute-words">
      <ul>
        {muteWords.map((word) => (
          <li>
            <button name="unmuteWord" value={word} ws-send>
              Unmute
            </button>{' '}
            {word}
          </li>
        ))}
      </ul>
      <form ws-send>
        <input type="text" name="muteWord" placeholder="word to mute" />
        <input type="submit" value="Mute" />
      </form>
    </div>
  );
};

export const renderMuteWords = (muteWords: Array<string>) =>
  render(<MuteWords muteWords={muteWords} />);
