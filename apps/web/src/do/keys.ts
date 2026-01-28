function pack(repoId: string, packName: string): string {
  return `repos/${repoId}/objects/packs/${packName}`;
}

export const Keys = {
  pack,
};
