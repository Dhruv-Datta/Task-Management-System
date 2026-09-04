import { getDb } from '@/lib/db';
import { apiJson, apiOk, withApiError } from '@/lib/apiResponses';
import { DEFAULT_LISTS } from '@/lib/tasks';
import { readSetting, writeSetting } from '@/lib/appSettings';

/*
  /api/lists: the task lists: which ones exist, how they are foldered, and which
  one you had open last.

  Three app_settings keys, `task_lists`, `task_list_groups` and
  `active_task_list_id`. A list is not a table: `tasks.list_id` is a plain text
  column, so creating one is a write of this blob and nothing else. A group is
  less than that again: a name, and a `group` field on the lists inside it.

  Shape: { lists: [{ id, name, group }], groups: [{ id, name }], activeListId }
*/

const LISTS_KEY = 'task_lists';
const GROUPS_KEY = 'task_list_groups';
const ACTIVE_KEY = 'active_task_list_id';

function shape(list) {
  return { id: list.id, name: list.name || 'Untitled list', group: list.group || null };
}

function shapeGroup(group) {
  return { id: group.id, name: group.name || 'Untitled group' };
}

// GET: { lists: [...], groups: [...], activeListId: '...' }
export async function GET() {
  return withApiError(async () => {
    const { supabase } = await getDb();
    const [lists, groups, activeId] = await Promise.all([
      readSetting(supabase, LISTS_KEY),
      readSetting(supabase, GROUPS_KEY),
      readSetting(supabase, ACTIVE_KEY),
    ]);

    return apiJson({
      lists: Array.isArray(lists) && lists.length > 0 ? lists.map(shape) : DEFAULT_LISTS,
      groups: Array.isArray(groups) ? groups.map(shapeGroup) : [],
      activeListId: activeId || 'default',
    });
  });
}

// PUT: save the lists, the groups, and/or which list is open
export async function PUT(req) {
  return withApiError(async () => {
    const { supabase } = await getDb();
    const { lists, groups, activeListId } = await req.json();

    const writes = [];
    if (lists !== undefined) {
      writes.push(writeSetting(supabase, LISTS_KEY, (lists || []).map(shape)));
    }
    if (groups !== undefined) {
      writes.push(writeSetting(supabase, GROUPS_KEY, (groups || []).map(shapeGroup)));
    }
    if (activeListId !== undefined) {
      writes.push(writeSetting(supabase, ACTIVE_KEY, activeListId));
    }
    await Promise.all(writes);

    return apiOk();
  });
}
