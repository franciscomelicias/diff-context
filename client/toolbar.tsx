import type { RpcOutput } from "@getpaseo/plugin";
import { useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import type { DiffMode, filesRpc } from "../shared/diff";
import type { Prefs } from "./prefs";
import type { Styles } from "./styles";

const ZOOM_STEPS = [0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.35, 1.5, 1.75, 2];

type Stack = RpcOutput<typeof filesRpc>["stack"];

/**
 * Two rows: what is compared, search and progress on top; how it is displayed underneath, with the
 * rarely changed toggles folded into a Filters menu.
 */
export function Toolbar({
  prefs,
  setPrefs,
  mode,
  stack,
  onMode,
  search,
  viewedCount,
  fileCount,
  hiddenTests,
  themes,
  allViewed,
  anyClosed,
  loading,
  onToggleAllViewed,
  onToggleAllOpen,
  onRefresh,
  onHelp,
  styles,
}: {
  prefs: Prefs;
  setPrefs: (changes: Partial<Prefs>) => void;
  mode: DiffMode;
  stack: Stack;
  onMode: (mode: DiffMode) => void;
  search: ReactNode;
  viewedCount: number;
  fileCount: number;
  hiddenTests: number;
  themes: { id: string; label: string }[] | null;
  allViewed: boolean;
  anyClosed: boolean;
  loading: boolean;
  onToggleAllViewed: () => void;
  onToggleAllOpen: () => void;
  onRefresh: () => void;
  onHelp: () => void;
  styles: Styles;
}) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilters = Number(prefs.hideWhitespace) + Number(prefs.hideTests);
  const zoomBy = (direction: 1 | -1) => {
    const index = ZOOM_STEPS.indexOf(prefs.zoom);
    setPrefs({ zoom: ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, (index === -1 ? 3 : index) + direction))] });
  };
  const themeLabel = themes?.find((option) => option.id === prefs.syntaxTheme)?.label ?? prefs.syntaxTheme;

  return (
    <View style={styles.toolbarBar}>
      <View style={styles.toolbarRow}>
        <IconButton label="☰" hint="Toggle file tree" active={prefs.showTree} onPress={() => setPrefs({ showTree: !prefs.showTree })} styles={styles} />
        <Segmented options={modeOptions(stack)} value={mode} onChange={onMode} styles={styles} />
        <View style={styles.toolbarGrow}>{search}</View>
        {fileCount > 0 ? (
          <View style={styles.progress}>
            <Text style={styles.toolbarMuted}>
              {viewedCount}/{fileCount}
            </Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${(viewedCount / fileCount) * 100}%` }]} />
            </View>
          </View>
        ) : null}
        <IconButton label={loading ? "…" : "↻"} hint="Refresh" onPress={onRefresh} styles={styles} />
      </View>

      <View style={[styles.toolbarRow, styles.toolbarRowSecondary]}>
        <Segmented
          options={[
            ["unified", "Unified"],
            ["split", "Split"],
          ]}
          value={prefs.viewMode}
          onChange={(viewMode) => setPrefs({ viewMode })}
          styles={styles}
        />
        <View style={styles.segmented}>
          <Pressable accessibilityRole="button" accessibilityLabel="Zoom out" onPress={() => zoomBy(-1)}>
            <Text style={styles.segment}>−</Text>
          </Pressable>
          {prefs.zoom !== 1 ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Reset zoom" onPress={() => setPrefs({ zoom: 1 })}>
              <Text style={styles.segment}>{Math.round(prefs.zoom * 100)}%</Text>
            </Pressable>
          ) : (
            <Text style={styles.segmentLabel}>Aa</Text>
          )}
          <Pressable accessibilityRole="button" accessibilityLabel="Zoom in" onPress={() => zoomBy(1)}>
            <Text style={styles.segment}>+</Text>
          </Pressable>
        </View>
        <View style={styles.menuAnchor}>
          <Pressable accessibilityRole="button" onPress={() => setFiltersOpen(!filtersOpen)}>
            <Text style={activeFilters > 0 ? styles.tabActive : styles.tab}>
              Filters{activeFilters > 0 ? ` · ${activeFilters}` : ""} ▾
            </Text>
          </Pressable>
          {filtersOpen ? (
            <View style={styles.menu}>
              <MenuCheck
                label="Hide whitespace changes"
                checked={prefs.hideWhitespace}
                onPress={() => setPrefs({ hideWhitespace: !prefs.hideWhitespace })}
                styles={styles}
              />
              <MenuCheck
                label={prefs.hideTests ? `Hide tests (${hiddenTests} hidden)` : "Hide tests"}
                checked={prefs.hideTests}
                onPress={() => setPrefs({ hideTests: !prefs.hideTests })}
                styles={styles}
              />
              {themes ? (
                <Pressable
                  accessibilityRole="button"
                  style={styles.menuItem}
                  onPress={() => {
                    const ids = themes.map((option) => option.id);
                    setPrefs({ syntaxTheme: ids[(ids.indexOf(prefs.syntaxTheme) + 1) % ids.length] });
                  }}
                >
                  <Text style={styles.menuText}>🎨 Colours: {themeLabel}</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </View>
        <View style={styles.toolbarGrow} />
        <Pressable accessibilityRole="button" disabled={fileCount === 0} onPress={onToggleAllViewed}>
          <Text style={styles.toolbarLink}>{allViewed ? "☐ Unmark all" : "☑ Mark all viewed"}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" disabled={fileCount === 0} onPress={onToggleAllOpen}>
          <Text style={styles.toolbarLink}>{anyClosed ? "▾ Expand all" : "▸ Collapse all"}</Text>
        </Pressable>
        <IconButton label="⌨" hint="Keyboard shortcuts" onPress={onHelp} styles={styles} />
      </View>
    </View>
  );
}

/** On a stacked branch the default view is this layer alone; "Stack" is every layer since the trunk. */
function modeOptions(stack: Stack): [DiffMode, string][] {
  if (!stack) {
    return [
      ["branch", "Branch"],
      ["uncommitted", "Uncommitted"],
    ];
  }
  const position = stack.position && stack.size ? ` ${stack.position}/${stack.size}` : "";
  return [
    ["branch", `Layer${position}`],
    ["stack", "Stack"],
    ["uncommitted", "Uncommitted"],
  ];
}

function Segmented<Value extends string>({
  options,
  value,
  onChange,
  styles,
}: {
  options: [Value, string][];
  value: Value;
  onChange: (value: Value) => void;
  styles: Styles;
}) {
  return (
    <View style={styles.segmented}>
      {options.map(([option, label]) => (
        <Pressable key={option} accessibilityRole="button" onPress={() => onChange(option)}>
          <Text style={value === option ? styles.segmentActive : styles.segment}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function IconButton({
  label,
  hint,
  active,
  onPress,
  styles,
}: {
  label: string;
  hint: string;
  active?: boolean;
  onPress: () => void;
  styles: Styles;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={hint} onPress={onPress}>
      <Text style={active ? styles.iconButtonActive : styles.iconButton}>{label}</Text>
    </Pressable>
  );
}

function MenuCheck({ label, checked, onPress, styles }: { label: string; checked: boolean; onPress: () => void; styles: Styles }) {
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked }} style={styles.menuItem} onPress={onPress}>
      <Text style={styles.menuText}>
        {checked ? "☑" : "☐"} {label}
      </Text>
    </Pressable>
  );
}
