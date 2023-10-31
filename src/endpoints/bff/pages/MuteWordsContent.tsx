import { Content } from './Content';
import { MuteWords } from './MuteWords.';

export const MuteWordsContent = ({
  handle,
  muteWords,
}: {
  handle: string;
  muteWords: Array<string>;
}) => {
  return (
    <Content>
      <h1>Welcome {handle}</h1>
      <MuteWords muteWords={muteWords} />
      <form id="form" ws-send>
        <input type="submit" name="loadMuteWords" value="Get Mute Words" />
      </form>
    </Content>
  );
};
