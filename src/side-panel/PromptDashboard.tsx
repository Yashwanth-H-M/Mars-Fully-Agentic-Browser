import * as Dialog from '@radix-ui/react-dialog';
import { useState } from 'react';
import type { Settings, SystemPromptPreset } from '@src/store/settings';
import { DEFAULT_PROMPT_PRESETS, settingsStorage } from '@src/store/settings';
import { newId } from '@src/store/conversations';
import { CheckIcon, CloseIcon, CopyIcon, PencilIcon, PlusIcon, PromptIcon, TrashIcon } from '@src/ui/icons';

interface PromptDashboardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: Settings;
}

export function PromptDashboard({ open, onOpenChange, settings }: PromptDashboardProps) {
  const presets: SystemPromptPreset[] =
    settings.customPrompts && settings.customPrompts.length > 0 ? settings.customPrompts : DEFAULT_PROMPT_PRESETS;
  const activePromptId = settings.activePromptId || 'default';

  // Form state for creating / editing a prompt
  const [editingPreset, setEditingPreset] = useState<SystemPromptPreset | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formText, setFormText] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const startCreate = () => {
    setEditingPreset(null);
    setFormName('');
    setFormDesc('');
    setFormText('');
    setIsCreating(true);
  };

  const startEdit = (preset: SystemPromptPreset) => {
    setEditingPreset(preset);
    setFormName(preset.name);
    setFormDesc(preset.description || '');
    setFormText(preset.prompt);
    setIsCreating(true);
  };

  const startDuplicate = (preset: SystemPromptPreset) => {
    setEditingPreset(null);
    setFormName(`${preset.name} (Copy)`);
    setFormDesc(preset.description ? `${preset.description} (Customized)` : '');
    setFormText(preset.prompt);
    setIsCreating(true);
  };

  const cancelForm = () => {
    setIsCreating(false);
    setEditingPreset(null);
    setFormName('');
    setFormDesc('');
    setFormText('');
  };

  const savePreset = async (activateImmediately: boolean) => {
    const trimmedName = formName.trim();
    if (!trimmedName) return;

    let updatedList: SystemPromptPreset[];
    const targetId = editingPreset ? editingPreset.id : newId();

    if (editingPreset) {
      updatedList = presets.map(p =>
        p.id === editingPreset.id
          ? {
              ...p,
              name: trimmedName,
              description: formDesc.trim() || undefined,
              prompt: formText.trim(),
            }
          : p,
      );
    } else {
      const newPreset: SystemPromptPreset = {
        id: targetId,
        name: trimmedName,
        description: formDesc.trim() || undefined,
        prompt: formText.trim(),
        isBuiltIn: false,
      };
      updatedList = [...presets, newPreset];
    }

    await settingsStorage.set(s => ({
      ...s,
      customPrompts: updatedList,
      activePromptId: activateImmediately ? targetId : s.activePromptId,
    }));

    cancelForm();
  };

  const selectPrompt = async (id: string) => {
    await settingsStorage.set(s => ({
      ...s,
      activePromptId: id,
    }));
  };

  const deletePrompt = async (id: string) => {
    const updatedList = presets.filter(p => p.id !== id);
    const nextActive = activePromptId === id ? 'default' : activePromptId;
    await settingsStorage.set(s => ({
      ...s,
      customPrompts: updatedList,
      activePromptId: nextActive,
    }));
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Content className="fixed inset-0 z-50 flex flex-col gap-3 bg-nb-canvas px-4 pb-3 pt-4 text-nb-fg focus:outline-none">
          {/* Header */}
          <div className="flex items-center gap-2 border-b border-nb-border/60 pb-3">
            <div className="flex size-8 items-center justify-center rounded-lg bg-nb-surface text-nb-accent">
              <PromptIcon size={18} />
            </div>
            <div className="flex-1">
              <Dialog.Title className="text-lg font-semibold leading-tight tracking-tight">System Prompts</Dialog.Title>
              <Dialog.Description className="text-xs text-nb-muted">
                Switch active agent prompt or create custom ones.
              </Dialog.Description>
            </div>
            <Dialog.Close
              className="flex size-8 items-center justify-center rounded-lg text-nb-muted hover:bg-nb-surface hover:text-nb-fg"
              aria-label="Close">
              <CloseIcon size={18} />
            </Dialog.Close>
          </div>

          {/* Body */}
          {isCreating ? (
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">{editingPreset ? 'Edit System Prompt' : 'Create Custom Prompt'}</h3>
                <span className="text-xs text-nb-muted">Fully isolated from other prompts</span>
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="prompt-name" className="text-xs font-medium text-nb-muted">Prompt Name *</label>
                <input
                  id="prompt-name"
                  type="text"
                  placeholder="e.g. CCBP Exam Specialist, Fast MCQ Solver..."
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  className="rounded-lg border border-nb-border bg-nb-bg px-3 py-1.5 text-sm placeholder:text-nb-muted focus:border-nb-accent focus:outline-none focus:ring-1 focus:ring-nb-accent"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="prompt-desc" className="text-xs font-medium text-nb-muted">Description (optional)</label>
                <input
                  id="prompt-desc"
                  type="text"
                  placeholder="Short note about what this prompt does"
                  value={formDesc}
                  onChange={e => setFormDesc(e.target.value)}
                  className="rounded-lg border border-nb-border bg-nb-bg px-3 py-1.5 text-sm placeholder:text-nb-muted focus:border-nb-accent focus:outline-none focus:ring-1 focus:ring-nb-accent"
                />
              </div>

              <div className="flex min-h-0 flex-1 flex-col gap-1.5">
                <label htmlFor="prompt-body" className="text-xs font-medium text-nb-muted">System Prompt Body *</label>
                <textarea
                  id="prompt-body"
                  placeholder="Enter full system prompt instructions for the agent..."
                  value={formText}
                  onChange={e => setFormText(e.target.value)}
                  className="min-h-48 flex-1 resize-y rounded-lg border border-nb-border bg-nb-bg p-3 font-mono text-xs leading-relaxed placeholder:text-nb-muted focus:border-nb-accent focus:outline-none focus:ring-1 focus:ring-nb-accent"
                />
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-nb-border/40 pt-2">
                <button
                  type="button"
                  onClick={cancelForm}
                  className="rounded-lg border border-nb-border px-3 py-1.5 text-xs font-medium text-nb-muted hover:bg-nb-surface hover:text-nb-fg">
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!formName.trim()}
                  onClick={() => savePreset(false)}
                  className="rounded-lg border border-nb-border bg-nb-surface px-3 py-1.5 text-xs font-medium hover:bg-nb-border/40 disabled:opacity-40">
                  Save
                </button>
                <button
                  type="button"
                  disabled={!formName.trim()}
                  onClick={() => savePreset(true)}
                  className="rounded-lg bg-nb-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-40">
                  Save & Activate
                </button>
              </div>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-nb-muted">Available Prompts ({presets.length})</span>
                <button
                  type="button"
                  onClick={startCreate}
                  className="flex items-center gap-1 rounded-lg bg-nb-accent/10 px-2.5 py-1 text-xs font-medium text-nb-accent hover:bg-nb-accent/20">
                  <PlusIcon size={14} />
                  <span>New Prompt</span>
                </button>
              </div>

              <ul className="-mx-1 flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-1 pb-1">
                {presets.map(preset => {
                  const isActive = preset.id === activePromptId;
                  const isExpanded = expandedId === preset.id;
                  return (
                    <li
                      key={preset.id}
                      className={`flex flex-col gap-2 rounded-xl border p-3 transition-colors ${
                        isActive
                          ? 'border-nb-accent/60 bg-nb-accent/5 dark:bg-nb-accent/10'
                          : 'border-nb-border/60 bg-nb-bg hover:border-nb-border'
                      }`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-nb-fg">{preset.name}</span>
                            {isActive ? (
                              <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                                <CheckIcon size={11} />
                                Active
                              </span>
                            ) : null}
                            {preset.isBuiltIn ? (
                              <span className="rounded bg-nb-surface px-1.5 py-0.5 text-[10px] text-nb-muted">
                                Built-in
                              </span>
                            ) : (
                              <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-600 dark:text-blue-400">
                                Custom
                              </span>
                            )}
                          </div>
                          {preset.description ? (
                            <p className="text-xs leading-normal text-nb-muted">{preset.description}</p>
                          ) : null}
                        </div>

                        {!isActive ? (
                          <button
                            type="button"
                            onClick={() => selectPrompt(preset.id)}
                            className="shrink-0 rounded-lg border border-nb-border/60 bg-nb-surface px-2.5 py-1 text-xs font-medium transition-colors hover:bg-nb-accent hover:text-white">
                            Use Prompt
                          </button>
                        ) : null}
                      </div>

                      {/* Prompt preview and action bar */}
                      <div className="flex items-center justify-between gap-2 border-t border-nb-border/40 pt-1 text-xs">
                        <button
                          type="button"
                          onClick={() => setExpandedId(isExpanded ? null : preset.id)}
                          className="text-[11px] text-nb-muted underline hover:text-nb-fg">
                          {isExpanded ? 'Hide prompt text' : 'View prompt text'}
                        </button>

                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            title="Duplicate as new custom prompt"
                            onClick={() => startDuplicate(preset)}
                            className="flex items-center gap-1 rounded p-1 text-nb-muted hover:bg-nb-surface hover:text-nb-fg">
                            <CopyIcon size={13} />
                            <span className="text-[11px]">Clone</span>
                          </button>

                          {!preset.isBuiltIn ? (
                            <>
                              <button
                                type="button"
                                title="Edit prompt"
                                onClick={() => startEdit(preset)}
                                className="flex items-center gap-1 rounded p-1 text-nb-muted hover:bg-nb-surface hover:text-nb-fg">
                                <PencilIcon size={13} />
                                <span className="text-[11px]">Edit</span>
                              </button>
                              <button
                                type="button"
                                title="Delete prompt"
                                onClick={() => deletePrompt(preset.id)}
                                className="flex items-center gap-1 rounded p-1 text-red-500 hover:bg-red-500/10">
                                <TrashIcon size={13} />
                                <span className="text-[11px]">Delete</span>
                              </button>
                            </>
                          ) : null}
                        </div>
                      </div>

                      {isExpanded ? (
                        <div className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg border border-nb-border/50 bg-nb-surface/80 p-2.5 font-mono text-[11px] leading-relaxed text-nb-fg">
                          {preset.prompt || '(Using hardcoded default exam & coding prompt)'}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
