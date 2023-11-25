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
      <h2 className="text-lg font-bold">Muted words for @{handle}</h2>
      <MuteWords muteWords={muteWords} />
    </>
  );
};
