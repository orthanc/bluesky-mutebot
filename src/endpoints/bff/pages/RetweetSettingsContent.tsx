/* eslint-disable @typescript-eslint/ban-ts-comment */
import { FollowingSet } from '../../../types';

const Autocomplete = ({
  data,
  'x-model': model,
}: {
  data: Array<{ value: string; display: string }>;
  'x-model'?: string;
}) => (
  <div
    x-data={`{
      open: false,
      data: ${JSON.stringify(data)},
      _filter: '',
      get filter() {
        return this._filter;
      },
      set filter(value) {
        this.selectedIndex = -1;
        this._filter = value;
      },
      selectedIndex: -1,
      get filteredData() {
        return this.data.filter((entry) => entry.display.toLowerCase().includes(this.filter.toLowerCase())).slice(0,10)
      },
      get selectedItem() {
        return this.filteredData[this.selectedIndex]
      },
      down() {
        if (this.selectedIndex < this.filteredData.length - 1) {
          this.selectedIndex++;
        }
      },
      up() {
        if (this.selectedIndex > -1) {
          this.selectedIndex--;
        }
      },
      selectItem(index) {
        if (index != null) this.selectedIndex = index;
        if (this.selectedItem == null) return;
        this.open = false;
        this.$dispatch('value-selected', this.selectedItem.value)
      },
    }`}
    x-modelable="selectedItem"
    x-model={model}
    {...{ 'x-on:click.away': 'open = false' }}
  >
    <input
      type="text"
      x-model="filter"
      placeholder="Search by handle..."
      className="border-slate-300 border w-full p-2"
      x-on:focus="open = true"
      {...{
        'x-on:keydown.arrow-down.stop.prevent': 'down()',
        'x-on:keydown.arrow-up.stop.prevent': 'up()',
        'x-on:keydown.enter.stop.prevent': 'selectItem()',
      }}
    />
    <ul
      x-cloak
      x-show="open && filter"
      className="rounded-b-lg border-slate-300 border bg-slate-50 dark:bg-slate-950"
    >
      {/* @ts-expect-error */}
      <template
        x-for="(entry, index) in filteredData"
        {...{ ':key': 'entry.value' }}
      >
        <li
          x-text="entry.display"
          x-on:click="selectItem(index)"
          x-bind:class="'border-slate-300 border-b p-2' + (index === selectedIndex ? ' bg-blue-100' : '')"
        />
        {/* @ts-expect-error */}
      </template>
    </ul>
  </div>
);

export const RetweetSettingsContent = ({
  handle,
  following,
}: {
  handle: string;
  following: FollowingSet;
}) => {
  const sortedFollowing = Object.entries(following)
    .map(([did, { handle }]) => ({ value: did, display: handle }))
    .sort((a, b) => a.display.localeCompare(b.display));
  return (
    <>
      <h2 className="text-lg font-bold">Retweet Settings for @{handle}</h2>
      <form
        x-data={JSON.stringify({ selectedFollower: null })}
        // hx-trigger="value-selected"
        // hx-post="/mutewords"
      >
        <Autocomplete data={sortedFollowing} x-model="selectedFollower" />
        <input
          type="hidden"
          name="did"
          x-bind:value="selectedFollower && selectedFollower.value"
        />
        <input
          type="hidden"
          name="handle"
          x-bind:value="selectedFollower && selectedFollower.value"
        />
      </form>
    </>
  );
};
