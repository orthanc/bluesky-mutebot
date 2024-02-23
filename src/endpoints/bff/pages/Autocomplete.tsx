/* eslint-disable @typescript-eslint/ban-ts-comment */
export const Autocomplete = ({
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
      selectedItem: null,
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
        const selectedIndex = index != null ? index : this.selectedIndex;
        this.selectedItem = this.filteredData[selectedIndex];
        if (this.selectedItem == null) return;
        this.filter = '';
        this.open = false;
        this.$dispatch('value-selected', this.selectedItem.value);
      },
      enterEdit() {
        if (this.selectedItem == null) return;
        this.filter = this.selectedItem.display;
        this.selectedItem = null;
      }
    }`}
    x-modelable="selectedItem"
    x-model={model}
  >
    <div
      x-cloak
      x-show="selectedItem"
      x-text="selectedItem && selectedItem.display"
      x-on:click="enterEdit()"
      className="underline"
    ></div>
    <div
      x-cloak
      x-show="!selectedItem"
      {...{ 'x-on:click.away': 'open = false' }}
    >
      <input
        type="text"
        x-model="filter"
        placeholder="Search by handle..."
        className="border-slate-300 border w-full p-2"
        x-on:focus="open = true"
        x-bind:data-valid="!selectedItem"
        {...{
          'x-on:keydown.arrow-down.stop.prevent': 'down()',
          'x-on:keydown.arrow-up.stop.prevent': 'up()',
          'x-on:keydown.enter.stop.prevent': 'selectItem()',
        }}
      />
      <ul
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
  </div>
);
