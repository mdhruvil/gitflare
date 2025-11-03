import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, Trash2 } from "lucide-react";
import { useState } from "react";

import { useSuspenseQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { useMutation } from "convex/react";
import { api } from "@gitvex/backend/convex/_generated/api";
import type { Id } from "@gitvex/backend/convex/_generated/dataModel";

export const Route = createFileRoute("/todos")({
	component: TodosRoute,
});

function TodosRoute() {
	const [newTodoText, setNewTodoText] = useState("");

	const todosQuery = useSuspenseQuery(convexQuery(api.todos.getAll, {}));
	const todos = todosQuery.data;

	const createTodo = useMutation(api.todos.create);
	const toggleTodo = useMutation(api.todos.toggle);
	const removeTodo = useMutation(api.todos.deleteTodo);

	const handleAddTodo = async (e: React.FormEvent) => {
		e.preventDefault();
		const text = newTodoText.trim();
		if (text) {
			setNewTodoText("");
			try {
				await createTodo({ text });
			} catch (error) {
				console.error("Failed to add todo:", error);
				setNewTodoText(text);
			}
		}
	};

	const handleToggleTodo = async (id: Id<"todos">, completed: boolean) => {
		try {
			await toggleTodo({ id, completed: !completed });
		} catch (error) {
			console.error("Failed to toggle todo:", error);
		}
	};

	const handleDeleteTodo = async (id: Id<"todos">) => {
		try {
			await removeTodo({ id });
		} catch (error) {
			console.error("Failed to delete todo:", error);
		}
	};

	return (
		<div className="mx-auto w-full max-w-md py-10">
			<Card>
				<CardHeader>
					<CardTitle>Todo List (Convex)</CardTitle>
					<CardDescription>Manage your tasks efficiently</CardDescription>
				</CardHeader>
				<CardContent>
					<form
						onSubmit={handleAddTodo}
						className="mb-6 flex items-center space-x-2"
					>
						<Input
							value={newTodoText}
							onChange={(e) => setNewTodoText(e.target.value)}
							placeholder="Add a new task..."
						/>
						<Button type="submit" disabled={!newTodoText.trim()}>
							Add
						</Button>
					</form>

					{todos?.length === 0 ? (
						<p className="py-4 text-center">No todos yet. Add one above!</p>
					) : (
						<ul className="space-y-2">
							{todos?.map((todo) => (
								<li
									key={todo._id}
									className="flex items-center justify-between rounded-md border p-2"
								>
									<div className="flex items-center space-x-2">
										<Checkbox
											checked={todo.completed}
											onCheckedChange={() =>
												handleToggleTodo(todo._id, todo.completed)
											}
											id={`todo-${todo._id}`}
										/>
										<label
											htmlFor={`todo-${todo._id}`}
											className={`${
												todo.completed
													? "text-muted-foreground line-through"
													: ""
											}`}
										>
											{todo.text}
										</label>
									</div>
									<Button
										variant="ghost"
										size="icon"
										onClick={() => handleDeleteTodo(todo._id)}
										aria-label="Delete todo"
									>
										<Trash2 className="h-4 w-4" />
									</Button>
								</li>
							))}
						</ul>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
