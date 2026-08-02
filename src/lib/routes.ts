export const routes = {
  home: import.meta.env.BASE_URL,
  parent: `${import.meta.env.BASE_URL}parent/`,
  kid: (slug: string) => `${import.meta.env.BASE_URL}kids/${slug}/`,
};
