import { MutedWord } from '../../../muteWordsStore';
import { MuteWords } from './MuteWords.';

export const MuteWordsContent = ({
  handle,
  muteWords,
  now,
}: {
  handle: string;
  muteWords: Array<MutedWord>;
  now: string;
}) => {
  return (
    <>
      <h2 className="text-lg font-bold">Muted words for @{handle}</h2>
      <MuteWords muteWords={muteWords} now={now} />
    </>
  );
};
