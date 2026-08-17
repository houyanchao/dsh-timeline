/**
 * 收藏体系共享操作流：移植原扩展 starred-tree-renderer 的 CRUD handler 与
 * star-input-modal 的文件夹选择菜单构建（新建/编辑/删除文件夹、复制、
 * 文件夹下拉树）。树组件与收藏弹窗共用。
 */
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from '../locales.ts'
import { toast } from '../ui/toast.tsx'
import { popconfirm } from '../ui/popconfirm.tsx'
import type { DropdownItem } from '../ui/dropdown.tsx'
import { folderEditModal } from './FolderEditModal.tsx'
import { starredStore, type Folder, type FolderNode } from './storage.ts'
import { FolderOutlineMenuIcon, NewSubfolderMenuIcon } from './icons.tsx'

type T = TranslateNS<typeof NS>

/** 文件夹名最大长度（原 maxLength: 15）。 */
const FOLDER_NAME_MAX = 15

/**
 * 新建文件夹流程（原 handleCreateFolder：弹窗 → 重名校验 → 创建 → toast）。
 * @param maxLength - 名称长度上限（收藏树入口 15；收藏弹窗入口原版为 10）。
 * @returns 新文件夹或 null（取消/失败）。
 */
export async function createFolderFlow(parentId: string | null, t: T, maxLength: number = FOLDER_NAME_MAX): Promise<Folder | null> {
  const parentPath = parentId !== null ? starredStore.getFolderPath(parentId) : ''
  const title = parentId !== null
    ? t('starred.newSubfolderIn', { folderName: parentPath })
    : t('starred.newFolder')

  const result = await folderEditModal.show({
    title,
    placeholder: t('starred.folderNamePlaceholder'),
    emptyMessage: t('starred.folderNameRequired'),
    confirmText: t('common.confirm'),
    cancelText: t('common.cancel'),
    maxLength,
  })
  if (result === null) return null

  if (starredStore.isFolderNameExists(result.name, parentId)) {
    toast.error(t('starred.folderNameExists'))
    return null
  }

  try {
    const folder = starredStore.createFolder(result.name, parentId, result.icon)
    toast.success(t('starred.folderCreated'))
    return folder
  } catch (error) {
    if (error instanceof Error && error.message !== '') toast.error(error.message)
    return null
  }
}

/** 编辑文件夹流程（原 handleEditFolder）。 */
export async function editFolderFlow(folderId: string, currentName: string, t: T): Promise<void> {
  const folder = starredStore.getFolders().find(f => f.id === folderId)
  if (folder === undefined) return
  const parentId = folder.parentId

  const result = await folderEditModal.show({
    title: t('starred.editFolder'),
    defaultName: currentName,
    defaultIcon: folder.icon,
    placeholder: t('starred.folderNamePlaceholder'),
    emptyMessage: t('starred.folderNameRequired'),
    confirmText: t('common.confirm'),
    cancelText: t('common.cancel'),
    maxLength: FOLDER_NAME_MAX,
  })
  if (result === null) return

  const nameChanged = result.name !== currentName
  const iconChanged = result.icon !== folder.icon
  if (!nameChanged && !iconChanged) return

  if (nameChanged && starredStore.isFolderNameExists(result.name, parentId, folderId)) {
    toast.error(t('starred.folderNameExists'))
    return
  }

  starredStore.updateFolder(folderId, result.name, result.icon)
  toast.success(t('starred.folderUpdated'))
}

/** 文件夹（含子文件夹）内收藏项总数（原 _countAllItems）。 */
export function countAllItems(folder: FolderNode): number {
  let count = folder.items.length
  for (const child of folder.children) count += countAllItems(child)
  return count
}

/** 删除文件夹流程（原 handleDeleteFolder：popconfirm → 删除 → toast）。 */
export async function deleteFolderFlow(folderId: string, t: T): Promise<void> {
  const tree = starredStore.getStarredByFolder()
  let folderData = tree.folders.find(f => f.id === folderId)
  if (folderData === undefined) {
    for (const parent of tree.folders) {
      const child = parent.children.find(c => c.id === folderId)
      if (child !== undefined) { folderData = child; break }
    }
  }
  if (folderData === undefined) {
    toast.error(t('starred.folderNotFound'))
    return
  }

  const totalItems = countAllItems(folderData)
  const confirmed = await popconfirm.show({
    title: t('starred.deleteFolderTitle', { folderName: folderData.name }),
    content: totalItems > 0 ? t('starred.deleteFolderContent', { count: totalItems }) : '',
    confirmTextType: 'danger',
    confirmText: t('common.confirm'),
    cancelText: t('common.cancel'),
  })
  if (!confirmed) return

  starredStore.deleteFolder(folderId)
  toast.success(t('starred.folderDeleted'))
}

/** 复制文本（原 handleCopy：clipboard API + textarea 兜底）。 */
export async function copyText(text: string, t: T): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(t('starred.copied'))
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.cssText = 'position:fixed;opacity:0'
    document.body.appendChild(ta)
    ta.select()
    try {
      document.execCommand('copy')
      toast.success(t('starred.copied'))
    } catch {
      toast.error(t('starred.copyFailed'))
    } finally {
      ta.remove()
    }
  }
}

/** 收藏弹窗内新建文件夹的名称上限（原 star-input-modal 的 maxLength: 10）。 */
const STAR_MODAL_FOLDER_NAME_MAX = 10

/**
 * 构建文件夹选择下拉树（移植 star-input-modal 的菜单构建：一级文件夹 +
 * 二级子菜单 + 各级"新建"入口，新建名称上限沿用原版的 10）。
 * @param onSelect - 选中回调（folderId + 展示路径）。
 */
export function buildFolderSelectItems(
  t: T,
  onSelect: (folderId: string, path: string) => void,
): DropdownItem[] {
  const folders = starredStore.getFolders()
  const items: DropdownItem[] = []
  const rootFolders = folders.filter(f => f.parentId === null).sort((a, b) => a.order - b.order)

  for (const rootFolder of rootFolders) {
    const childFolders = folders
      .filter(f => f.parentId === rootFolder.id)
      .sort((a, b) => a.order - b.order)

    const subItems: DropdownItem[] = childFolders.map(child => ({
      label: child.name,
      icon: <FolderOutlineMenuIcon />,
      onClick: () => { onSelect(child.id, `${rootFolder.name} / ${child.name}`) },
    }))

    if (childFolders.length > 0) subItems.push({ type: 'divider' })
    subItems.push({
      label: t('starred.newSubfolder'),
      className: 'create-action',
      icon: <NewSubfolderMenuIcon />,
      onClick: () => {
        void createFolderFlow(rootFolder.id, t, STAR_MODAL_FOLDER_NAME_MAX).then((newFolder) => {
          if (newFolder !== null) onSelect(newFolder.id, `${rootFolder.name} / ${newFolder.name}`)
        })
      },
    })

    items.push({
      label: rootFolder.name,
      icon: <FolderOutlineMenuIcon />,
      children: subItems,
      onClick: () => { onSelect(rootFolder.id, rootFolder.name) },
    })
  }

  items.push({ type: 'divider' })
  items.push({
    label: t('starred.newFolder'),
    className: 'create-action',
    icon: <NewSubfolderMenuIcon />,
    onClick: () => {
      void createFolderFlow(null, t, STAR_MODAL_FOLDER_NAME_MAX).then((newFolder) => {
        if (newFolder !== null) onSelect(newFolder.id, newFolder.name)
      })
    },
  })

  return items
}
