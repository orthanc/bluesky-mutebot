import { MuteWords } from './MuteWords.';

export const MuteWordsContent = ({
  handle,
  muteWords,
}: {
  handle: string;
  muteWords: Array<string>;
}) => {
  return (
    <>
      <h1>Welcome {handle}</h1>
      <MuteWords muteWords={muteWords} />
      <form hx-get="/mutewords">
        <input type="submit" name="loadMuteWords" value="Get Mute Words" />
      </form>
    </>
  );
};
