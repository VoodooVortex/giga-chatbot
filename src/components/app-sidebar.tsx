import * as React from "react"
import { SquarePen, Folder, Menu } from "lucide-react"

import {
    Sidebar,
    SidebarContent,
    SidebarGroup,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuItem,
    SidebarMenuButton,
    SidebarProvider,
    SidebarTrigger,
} from "@/components/ui/sidebar"

const historyItems = [
    {
        title: "มีคอมพิวเตอร์ว่างให้ยืมไหม",
        url: "#",
        icon: Folder,
    },
    {
        title: "วันนี้มีโต๊ะเหลือว่างให้ยืมบ้างไหม",
        url: "#",
        icon: Folder,
    },
]

export function AppSidebar() {
    return (
        <Sidebar side="right" variant="sidebar" className="border-l bg-white w-72">
            <SidebarHeader className="p-4 pt-6">
                <SidebarMenu>
                    <SidebarMenuItem>
                        <SidebarMenuButton className="h-10 text-base flex gap-3 text-slate-800 hover:bg-slate-100">
                            <SquarePen className="w-5 h-5" />
                            <span>แชทใหม่</span>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarHeader>

            <SidebarContent>
                <SidebarGroup>
                    <SidebarGroupLabel className="text-xs font-medium text-slate-400 px-4 py-2">
                        แชท
                    </SidebarGroupLabel>
                    <SidebarGroupContent>
                        <SidebarMenu className="px-2">
                            {historyItems.map((item) => (
                                <SidebarMenuItem key={item.title}>
                                    <SidebarMenuButton
                                        asChild
                                        className="h-12 flex gap-3 text-slate-700 hover:text-slate-900 hover:bg-slate-100 whitespace-normal text-sm items-start py-2.5"
                                    >
                                        <a href={item.url}>
                                            <item.icon className="w-5 h-5 shrink-0 mt-0.5" />
                                            <span className="line-clamp-2 leading-snug">{item.title}</span>
                                        </a>
                                    </SidebarMenuButton>
                                </SidebarMenuItem>
                            ))}
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>
            </SidebarContent>
        </Sidebar>
    )
}
