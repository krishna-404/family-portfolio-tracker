import { TopProgressBar } from "@frontend/components/layout/TopProgressBar";
import { Outlet } from "react-router";

export const RootLayout = () => {
	return (
		<>
			<TopProgressBar />
			<Outlet />
		</>
	);
};
