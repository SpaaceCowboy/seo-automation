const uuid =
  "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
export function allowedControlPath(path: string, method: string) {
  if (method === "GET")
    return (
      path === "/control/sites" ||
      path === "/control/integrations" ||
      new RegExp(
        `^/sites/${uuid}/control/(overview|crawls|issues|performance|opportunities|agents|recommendations|changes|measurements|freshness|signals)(/${uuid})?$`,
      ).test(path)
    );
  return (
    method === "POST" &&
    (path === "/control/integrations/openai/check" ||
      new RegExp(
        `^/sites/${uuid}/workflow/(recommendations(/${uuid}/(decisions|versions|implementation))?|changes/${uuid}/(reverts|corrections|baselines|measurements/(30|60|90)))$`,
      ).test(path))
  );
}
