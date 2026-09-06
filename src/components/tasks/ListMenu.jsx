'use client';

/*
  The list switcher: the page title doubles as the picker, Linear-style.

  A list is one body of work, and exactly one is open at a time. Whichever you
  pick scopes both views and every write to it, so the page never mixes one
  list's work into another's.

  Four things happen in here, and they are deliberately the only four:

    switch   click a list. That is the menu's whole job; everything else is
             quiet until you point at a row.
    order    drag a row by its handle. The order you put your lists in is the
             order you think about them in, and it is worth keeping.
    group    a folder of lists. "School" holds one list per class, and the
             switcher shows the word School until you open it. Dragging a list
             onto a group's rows (or onto its header) files it there; dragging
             it back out to the top takes it out again.
    edit     create, rename, delete, for both lists and groups. Deleting a
             group deletes the folder and never the work in it: its lists come
             back out to the top level.

  The arrangement itself is pure and lives in lib/tasks.js (`listTree`,
  `reorderLists`, `moveListToGroup`); this file is what it looks like.

  Adapted from AlphaOS's TeamMenu. What it lost is membership: a team there had
  a roster drawn from the workspace's logins, and with a single login there is
  nobody to put on one.
*/

import { useMemo, useRef, useState } from 'react';
import {
  Check, ChevronDown, ChevronRight, FolderPlus, GripVertical, Pencil, Plus, Trash2, X,
} from 'lucide-react';
import { DndContext, PointerSensor, closestCenter, useDroppable, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { listTree } from '@/lib/tasks';
import { LIST_MENU_HEIGHT, MenuPortal } from './TaskPickers';

// Droppable ids have to be distinguishable from list ids, because a drop is
// either "beside this list" or "into this folder" and they are handled
// differently. `__none__` is the top level, which is a folder like any other as
// far as the drag is concerned.
const ZONE = 'zone:';
const TOP_LEVEL = `${ZONE}__none__`;
const zoneId = groupId => `${ZONE}${groupId ?? '__none__'}`;
const zoneGroup = id => (id === TOP_LEVEL ? null : String(id).slice(ZONE.length));

/** A one-line form, used for every name typed in this menu. */
function NameForm({ value, placeholder, onChange, onSubmit, onCancel }) {
  return (
    <form
      className="flex-1 flex items-center gap-1"
      onSubmit={e => { e.preventDefault(); if (value.trim()) onSubmit(value.trim()); }}
    >
      <input
        autoFocus
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => { if (e.key === 'Escape') onCancel(); }}
        className="flex-1 min-w-0 text-sm px-2 py-1 border border-gray-200 rounded-lg outline-none focus:ring-1 focus:ring-emerald-500"
      />
      <button type="submit" disabled={!value.trim()} className="p-1 text-emerald-600 hover:text-emerald-700 disabled:opacity-30">
        <Check size={14} />
      </button>
      <button type="button" onClick={onCancel} className="p-1 text-gray-300 hover:text-gray-500">
        <X size={14} />
      </button>
    </form>
  );
}

/** Are you sure, inline, where the row was. */
function ConfirmDelete({ label, onYes, onNo }) {
  return (
    <div className="flex-1 flex items-center gap-2">
      <span className="text-xs text-red-600 truncate">{label}</span>
      <button
        onClick={onYes}
        className="ml-auto text-[11px] font-semibold px-2 py-0.5 bg-red-500 text-white rounded-lg hover:bg-red-600"
      >Yes</button>
      <button
        onClick={onNo}
        className="text-[11px] font-semibold px-2 py-0.5 bg-gray-200 text-gray-600 rounded-lg hover:bg-gray-300"
      >No</button>
    </div>
  );
}

/*
  One list. Sortable by its handle only: the rest of the row is a button that
  opens the list, and a row you cannot click without dragging it is a row you
  cannot use.
*/
function ListRow({
  list, active, indented, renaming, confirming, renameValue,
  onSwitch, onStartRename, onRenameChange, onRename, onCancelRename,
  onAskDelete, onDelete, onCancelDelete, deletable,
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: list.id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`group/row flex items-center gap-1 pr-2 py-1.5 transition-colors ${indented ? 'pl-6' : 'pl-2'} ${
        isDragging ? 'opacity-40' : active ? 'bg-gray-50' : 'hover:bg-gray-50'
      }`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        title="Drag to reorder"
        aria-label={`Reorder ${list.name}`}
        className="p-0.5 -ml-0.5 text-gray-300 opacity-0 group-hover/row:opacity-100 focus:opacity-100 cursor-grab active:cursor-grabbing hover:text-gray-500 transition-opacity"
      >
        <GripVertical size={13} />
      </button>

      {renaming ? (
        <NameForm
          value={renameValue}
          onChange={onRenameChange}
          onSubmit={onRename}
          onCancel={onCancelRename}
        />
      ) : confirming ? (
        <ConfirmDelete label="Delete list and its tasks?" onYes={onDelete} onNo={onCancelDelete} />
      ) : (
        <>
          <button
            type="button"
            onClick={onSwitch}
            className={`flex-1 text-left text-sm truncate ${active ? 'font-semibold text-gray-900' : 'text-gray-600'}`}
          >
            {list.name}
          </button>
          <div className="flex items-center gap-0.5 opacity-0 group-hover/row:opacity-100 transition-opacity">
            <button onClick={onStartRename} className="p-1 text-gray-400 hover:text-gray-700" title="Rename">
              <Pencil size={13} />
            </button>
            {/* Never offered on the last list: the page always has one open, so
                deleting it would leave nowhere to be. */}
            {deletable && (
              <button onClick={onAskDelete} className="p-1 text-gray-400 hover:text-red-500" title="Delete">
                <Trash2 size={13} />
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/*
  A folder, closed by default unless the list you have open is inside it. The
  whole header is the toggle, and it is also the drop target for the folder, so
  a group with nothing in it yet still has somewhere to drop a list.
*/
function GroupHeader({
  group, count, open, dragging, renaming, confirming, renameValue,
  onToggle, onAdd, onStartRename, onRenameChange, onRename, onCancelRename,
  onAskDelete, onDelete, onCancelDelete,
}) {
  const { setNodeRef, isOver } = useDroppable({ id: zoneId(group.id) });
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <div
      ref={setNodeRef}
      className={`group/row flex items-center gap-1 pl-2 pr-2 py-1.5 mt-0.5 transition-colors ${
        isOver ? 'bg-emerald-50' : 'hover:bg-gray-50'
      }`}
    >
      {renaming ? (
        <NameForm value={renameValue} onChange={onRenameChange} onSubmit={onRename} onCancel={onCancelRename} />
      ) : confirming ? (
        <ConfirmDelete label="Delete group? Its lists stay." onYes={onDelete} onNo={onCancelDelete} />
      ) : (
        <>
          <button type="button" onClick={onToggle} className="flex-1 flex items-center gap-1.5 min-w-0 text-left">
            <Chevron size={13} className="text-gray-400 flex-shrink-0" />
            <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500 truncate">{group.name}</span>
            <span className="text-[11px] font-bold text-gray-300 tabular-nums">{count || ''}</span>
            {/* While a list is in the air, say what dropping here would do. */}
            {dragging && <span className="text-[10px] text-emerald-600 font-semibold">drop to file</span>}
          </button>
          <div className="flex items-center gap-0.5 opacity-0 group-hover/row:opacity-100 transition-opacity">
            <button onClick={onAdd} className="p-1 text-gray-400 hover:text-emerald-600" title="New list in this group">
              <Plus size={13} />
            </button>
            <button onClick={onStartRename} className="p-1 text-gray-400 hover:text-gray-700" title="Rename group">
              <Pencil size={13} />
            </button>
            <button onClick={onAskDelete} className="p-1 text-gray-400 hover:text-red-500" title="Delete group">
              <Trash2 size={13} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default function ListMenu({
  lists, groups = [], activeListId,
  onSwitch, onCreate, onRename, onDelete,
  onReorder, onMoveToGroup, onCreateGroup, onRenameGroup, onDeleteGroup,
}) {
  const anchorRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(null);        // null | { group: id|null }
  const [newName, setNewName] = useState('');
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [renaming, setRenaming] = useState(null);        // null | { kind, id }
  const [renameValue, setRenameValue] = useState('');
  const [confirming, setConfirming] = useState(null);    // null | { kind, id }
  const [toggled, setToggled] = useState({});            // only the folders you have opened or shut yourself
  const [dragging, setDragging] = useState(null);

  const close = () => {
    setOpen(false);
    setCreating(null);
    setCreatingGroup(false);
    setRenaming(null);
    setConfirming(null);
  };

  const active = lists.find(l => l.id === activeListId) || lists[0];
  const tree = useMemo(() => listTree(lists, groups), [lists, groups]);

  // A folder opens by default only when what you have open is inside it. Any
  // click you make on it wins from then on.
  const isOpen = section => toggled[section.id] ?? section.lists.some(l => l.id === activeListId);

  // The sortable order has to match the drawn order, or a drag lands somewhere
  // other than where you dropped it.
  const sortableIds = useMemo(() => [
    ...tree.ungrouped.map(l => l.id),
    ...tree.sections.flatMap(s => (isOpen(s) ? s.lists.map(l => l.id) : [])),
  ], [tree, toggled, activeListId]); // eslint-disable-line react-hooks/exhaustive-deps

  const sensors = useSensors(useSensor(PointerSensor, {
    // Enough to tell a drag from a click on the handle.
    activationConstraint: { distance: 4 },
  }));

  const handleDragEnd = ({ active: dragged, over }) => {
    setDragging(null);
    if (!over || dragged.id === over.id) return;
    if (String(over.id).startsWith(ZONE)) {
      const groupId = zoneGroup(over.id);
      onMoveToGroup(dragged.id, groupId);
      if (groupId) setToggled(t => ({ ...t, [groupId]: true }));
      return;
    }
    onReorder(dragged.id, over.id);
  };

  const rowProps = list => ({
    list,
    active: list.id === activeListId,
    deletable: lists.length > 1,
    renaming: renaming?.kind === 'list' && renaming.id === list.id,
    confirming: confirming?.kind === 'list' && confirming.id === list.id,
    renameValue,
    onSwitch: () => { onSwitch(list.id); close(); },
    onStartRename: () => { setRenaming({ kind: 'list', id: list.id }); setRenameValue(list.name); },
    onRenameChange: setRenameValue,
    onRename: name => { onRename(list.id, name); setRenaming(null); },
    onCancelRename: () => setRenaming(null),
    onAskDelete: () => setConfirming({ kind: 'list', id: list.id }),
    onDelete: () => { onDelete(list.id); setConfirming(null); close(); },
    onCancelDelete: () => setConfirming(null),
  });

  const createForm = (group) => (
    <div className="flex items-center gap-1 px-3 py-1.5">
      <NameForm
        value={newName}
        placeholder={group ? 'List name in this group…' : 'List name…'}
        onChange={setNewName}
        onSubmit={name => { onCreate(name, group); close(); }}
        onCancel={() => setCreating(null)}
      />
    </div>
  );

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        className="group flex items-center gap-2"
      >
        <h1 className="text-2xl font-bold text-gray-900">{active?.name || 'Tasks'}</h1>
        <ChevronDown size={18} className={`text-gray-400 group-hover:text-gray-600 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <MenuPortal anchorRef={anchorRef} onClose={close} width={300} maxHeight={LIST_MENU_HEIGHT} fit={LIST_MENU_HEIGHT}>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={({ active: dragged }) => setDragging(dragged.id)}
            onDragCancel={() => setDragging(null)}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
              <TopLevel dragging={dragging} hasLists={tree.ungrouped.length > 0}>
                {tree.ungrouped.map(list => (
                  <ListRow key={list.id} indented={false} {...rowProps(list)} />
                ))}
              </TopLevel>

              {tree.sections.map(section => (
                <div key={section.id}>
                  <GroupHeader
                    group={section}
                    count={section.lists.length}
                    open={isOpen(section)}
                    dragging={!!dragging}
                    renaming={renaming?.kind === 'group' && renaming.id === section.id}
                    confirming={confirming?.kind === 'group' && confirming.id === section.id}
                    renameValue={renameValue}
                    onToggle={() => setToggled(t => ({ ...t, [section.id]: !isOpen(section) }))}
                    onAdd={() => {
                      setToggled(t => ({ ...t, [section.id]: true }));
                      setCreating({ group: section.id });
                      setNewName('');
                    }}
                    onStartRename={() => { setRenaming({ kind: 'group', id: section.id }); setRenameValue(section.name); }}
                    onRenameChange={setRenameValue}
                    onRename={name => { onRenameGroup(section.id, name); setRenaming(null); }}
                    onCancelRename={() => setRenaming(null)}
                    onAskDelete={() => setConfirming({ kind: 'group', id: section.id })}
                    onDelete={() => { onDeleteGroup(section.id); setConfirming(null); }}
                    onCancelDelete={() => setConfirming(null)}
                  />
                  {isOpen(section) && (
                    <>
                      {section.lists.map(list => (
                        <ListRow key={list.id} indented {...rowProps(list)} />
                      ))}
                      {section.lists.length === 0 && creating?.group !== section.id && (
                        <p className="pl-6 pr-3 py-1.5 text-[12px] text-gray-400">Nothing in here yet.</p>
                      )}
                    </>
                  )}
                  {creating?.group === section.id && createForm(section.id)}
                </div>
              ))}
            </SortableContext>
          </DndContext>

          <div className="border-t border-gray-100 mt-1 pt-1">
            {creating && creating.group === null ? createForm(null) : creatingGroup ? (
              <div className="flex items-center gap-1 px-3 py-1.5">
                <NameForm
                  value={newGroupName}
                  placeholder="Group name…"
                  onChange={setNewGroupName}
                  onSubmit={name => { onCreateGroup(name); setCreatingGroup(false); setNewGroupName(''); }}
                  onCancel={() => setCreatingGroup(false)}
                />
              </div>
            ) : (
              <div className="flex items-center">
                <button
                  type="button"
                  onClick={() => { setCreating({ group: null }); setNewName(''); }}
                  className="flex-1 text-left px-4 py-2 text-sm text-gray-500 hover:bg-gray-50 hover:text-gray-700 flex items-center gap-2 transition-colors"
                >
                  <Plus size={14} />
                  New list…
                </button>
                <button
                  type="button"
                  onClick={() => { setCreatingGroup(true); setNewGroupName(''); }}
                  title="A folder of lists"
                  className="px-4 py-2 text-sm text-gray-500 hover:bg-gray-50 hover:text-gray-700 flex items-center gap-2 transition-colors"
                >
                  <FolderPlus size={14} />
                  Group…
                </button>
              </div>
            )}
          </div>
        </MenuPortal>
      )}
    </>
  );
}

/*
  The top level is a drop target too, so a list can come back OUT of a folder.
  When everything is filed there is nothing up here to drop beside, so while a
  drag is happening it draws itself a landing strip.
*/
function TopLevel({ dragging, hasLists, children }) {
  const { setNodeRef, isOver } = useDroppable({ id: TOP_LEVEL });
  return (
    <div ref={setNodeRef}>
      {children}
      {dragging && !hasLists && (
        <p className={`mx-2 my-1 px-3 py-2 text-[12px] text-center rounded-lg border border-dashed transition-colors ${
          isOver ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-gray-200 text-gray-400'
        }`}>
          Drop here to take it out of its group
        </p>
      )}
    </div>
  );
}
