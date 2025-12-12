async function fetchUser(): Promise<{ name: "teo" }> {
  return { name: "Teo" };
}

const user =fetchUser();
console.log(user.name);
